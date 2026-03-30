import { z } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc.js";
import { db, schema } from "../db.js";

interface BackupTag {
  id: number;
  name: string;
  color: string | null;
}

interface BackupTrade {
  symbol: string;
  side: string;
  quantity: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  entryDate: number | null;
  exitDate: number | null;
  pnl: number | null;
  fees: number | null;
  netPnl: number | null;
  status: string;
  notes: string | null;
  accountId: number | null;
  strategyId: number | null;
  tagIds: number[];
}

interface BackupAccount {
  id: number;
  name: string;
  broker: string | null;
  accountNumber: string | null;
  description: string | null;
  color: string | null;
  isDefault: boolean;
}

interface BackupData {
  version: number;
  exportedAt: string;
  trades: BackupTrade[];
  tags: BackupTag[];
  accounts: BackupAccount[];
}

function isBackupData(obj: unknown): obj is BackupData {
  if (!obj || typeof obj !== "object") return false;
  const d = obj as Record<string, unknown>;
  return (
    typeof d.version === "number" &&
    typeof d.exportedAt === "string" &&
    Array.isArray(d.trades) &&
    Array.isArray(d.tags) &&
    Array.isArray(d.accounts)
  );
}

export const backupRouter = router({
  export: protectedProcedure
    .input(
      z.object({
        accountId: z.number().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Fetch trades
      const tradeConditions = [eq(schema.trades.userId, userId)];
      if (input.accountId !== undefined) {
        tradeConditions.push(eq(schema.trades.accountId, input.accountId));
      }

      const trades = await db
        .select()
        .from(schema.trades)
        .where(and(...tradeConditions));

      // Fetch all trade_tags for these trades
      const tradeIds = trades.map((t) => t.id);
      const tradeTagRows =
        tradeIds.length > 0
          ? await db
              .select()
              .from(schema.tradeTags)
              .where(inArray(schema.tradeTags.tradeId, tradeIds))
          : [];

      const tagIdsByTradeId = new Map<number, number[]>();
      for (const row of tradeTagRows) {
        if (!tagIdsByTradeId.has(row.tradeId)) tagIdsByTradeId.set(row.tradeId, []);
        tagIdsByTradeId.get(row.tradeId)!.push(row.tagId);
      }

      // Fetch tags
      const tags = await db
        .select()
        .from(schema.tags)
        .where(eq(schema.tags.userId, userId));

      // Fetch accounts
      const accounts = await db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.userId, userId));

      const payload: BackupData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        trades: trades.map((t) => ({
          symbol: t.symbol,
          side: t.side,
          quantity: t.quantity,
          entryPrice: t.entryPrice,
          exitPrice: t.exitPrice,
          entryDate: t.entryDate,
          exitDate: t.exitDate,
          pnl: t.pnl,
          fees: t.fees,
          netPnl: t.netPnl,
          status: t.status,
          notes: t.notes,
          accountId: t.accountId,
          strategyId: t.strategyId,
          tagIds: tagIdsByTradeId.get(t.id) ?? [],
        })),
        tags: tags.map((tg) => ({
          id: tg.id,
          name: tg.name,
          color: tg.color,
        })),
        accounts: accounts.map((a) => ({
          id: a.id,
          name: a.name,
          broker: a.broker,
          accountNumber: a.accountNumber,
          description: a.description,
          color: a.color,
          isDefault: a.isDefault,
        })),
      };

      return JSON.stringify(payload);
    }),

  import: protectedProcedure
    .input(
      z.object({
        data: z.string(),
        accountId: z.number().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      let parsed: unknown;
      try {
        parsed = JSON.parse(input.data);
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid JSON" });
      }

      if (!isBackupData(parsed)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid backup format: missing required fields (version, exportedAt, trades, tags, accounts)",
        });
      }

      const backup = parsed;

      // If an accountId override is provided, verify ownership
      if (input.accountId) {
        const [acct] = await db
          .select({ id: schema.accounts.id })
          .from(schema.accounts)
          .where(and(eq(schema.accounts.id, input.accountId), eq(schema.accounts.userId, userId)))
          .limit(1);

        if (!acct) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
        }
      }

      // Build a mapping from backup tag ids to existing/new tag ids for this user
      const existingTags = await db
        .select()
        .from(schema.tags)
        .where(eq(schema.tags.userId, userId));

      const existingTagsByName = new Map(existingTags.map((t) => [t.name.toLowerCase(), t]));
      const backupTagIdToLocalId = new Map<number, number>();

      for (const backupTag of backup.tags) {
        const existing = existingTagsByName.get(backupTag.name.toLowerCase());
        if (existing) {
          backupTagIdToLocalId.set(backupTag.id, existing.id);
        } else {
          const [created] = await db
            .insert(schema.tags)
            .values({
              userId,
              name: backupTag.name,
              color: backupTag.color ?? "#6366f1",
            })
            .returning();
          backupTagIdToLocalId.set(backupTag.id, created.id);
          existingTagsByName.set(backupTag.name.toLowerCase(), created);
        }
      }

      // Insert trades
      let imported = 0;
      for (const backupTrade of backup.trades) {
        if (!backupTrade.symbol || !backupTrade.side) continue;

        const side = String(backupTrade.side).toLowerCase();
        if (side !== "long" && side !== "short") continue;

        const accountIdToUse = input.accountId ?? backupTrade.accountId ?? null;

        // Verify accountId still belongs to this user if set
        let resolvedAccountId: number | null = null;
        if (accountIdToUse !== null) {
          const [acct] = await db
            .select({ id: schema.accounts.id })
            .from(schema.accounts)
            .where(and(eq(schema.accounts.id, accountIdToUse), eq(schema.accounts.userId, userId)))
            .limit(1);
          if (acct) resolvedAccountId = acct.id;
        }

        const pnl = typeof backupTrade.pnl === "number" ? backupTrade.pnl : null;
        const fees = typeof backupTrade.fees === "number" ? backupTrade.fees : 0;
        const netPnl = (pnl ?? 0) - (fees ?? 0);

        const [trade] = await db
          .insert(schema.trades)
          .values({
            userId,
            accountId: resolvedAccountId,
            strategyId: null, // strategies are not included in backup v1
            symbol: String(backupTrade.symbol).toUpperCase(),
            side: side as "long" | "short",
            quantity: typeof backupTrade.quantity === "number" ? backupTrade.quantity : null,
            entryPrice: typeof backupTrade.entryPrice === "number" ? backupTrade.entryPrice : null,
            exitPrice: typeof backupTrade.exitPrice === "number" ? backupTrade.exitPrice : null,
            entryDate: typeof backupTrade.entryDate === "number" ? backupTrade.entryDate : null,
            exitDate: typeof backupTrade.exitDate === "number" ? backupTrade.exitDate : null,
            pnl,
            fees: fees ?? 0,
            netPnl,
            status:
              backupTrade.status === "closed" || backupTrade.status === "open"
                ? backupTrade.status
                : "open",
            notes: backupTrade.notes ? String(backupTrade.notes).slice(0, 1000) : null,
          })
          .returning();

        // Recreate tag associations
        if (Array.isArray(backupTrade.tagIds) && backupTrade.tagIds.length > 0) {
          const localTagIds = backupTrade.tagIds
            .map((bId) => backupTagIdToLocalId.get(bId))
            .filter((id): id is number => id !== undefined);

          if (localTagIds.length > 0) {
            await db.insert(schema.tradeTags).values(
              localTagIds.map((tagId) => ({ tradeId: trade.id, tagId }))
            );
          }
        }

        imported++;
      }

      return { imported };
    }),
});
