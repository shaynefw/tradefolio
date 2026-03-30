import { z } from "zod";
import { eq, and, asc, desc, sql, inArray, gte, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc.js";
import { db, schema } from "../db.js";
import { LIMITS } from "../../shared/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDate(value: string | undefined | null): number | null {
  if (!value) return null;

  // Try mm/dd/yy or mm/dd/yyyy
  const mdyMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdyMatch) {
    let year = parseInt(mdyMatch[3], 10);
    if (year < 100) year += year >= 50 ? 1900 : 2000;
    const d = new Date(year, parseInt(mdyMatch[1], 10) - 1, parseInt(mdyMatch[2], 10));
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  // ISO or any other parseable string
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.getTime();
}

async function attachTagsToTrades<T extends { id: number }>(trades: T[]) {
  if (trades.length === 0) return trades.map((t) => ({ ...t, tags: [] }));

  const tradeIds = trades.map((t) => t.id);

  const tradeTagRows = await db
    .select({
      tradeId: schema.tradeTags.tradeId,
      tagId: schema.tags.id,
      tagName: schema.tags.name,
      tagColor: schema.tags.color,
      tagUserId: schema.tags.userId,
      tagCreatedAt: schema.tags.createdAt,
    })
    .from(schema.tradeTags)
    .innerJoin(schema.tags, eq(schema.tradeTags.tagId, schema.tags.id))
    .where(inArray(schema.tradeTags.tradeId, tradeIds));

  const tagsByTradeId = new Map<number, Array<{ id: number; name: string; color: string | null; userId: number; createdAt: Date }>>();

  for (const row of tradeTagRows) {
    if (!tagsByTradeId.has(row.tradeId)) {
      tagsByTradeId.set(row.tradeId, []);
    }
    tagsByTradeId.get(row.tradeId)!.push({
      id: row.tagId,
      name: row.tagName,
      color: row.tagColor,
      userId: row.tagUserId,
      createdAt: row.tagCreatedAt,
    });
  }

  return trades.map((t) => ({
    ...t,
    tags: tagsByTradeId.get(t.id) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const tradeRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        accountId: z.number().optional(),
        strategyId: z.number().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        status: z.enum(["open", "closed"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const conditions = [eq(schema.trades.userId, userId)];

      if (input.accountId !== undefined) {
        conditions.push(eq(schema.trades.accountId, input.accountId));
      }
      if (input.strategyId !== undefined) {
        conditions.push(eq(schema.trades.strategyId, input.strategyId));
      }
      if (input.status !== undefined) {
        conditions.push(eq(schema.trades.status, input.status));
      }
      if (input.startDate !== undefined) {
        const ts = parseDate(input.startDate);
        if (ts !== null) conditions.push(gte(schema.trades.entryDate, ts));
      }
      if (input.endDate !== undefined) {
        const ts = parseDate(input.endDate);
        if (ts !== null) conditions.push(lte(schema.trades.entryDate, ts));
      }

      const trades = await db
        .select({
          id: schema.trades.id,
          userId: schema.trades.userId,
          accountId: schema.trades.accountId,
          strategyId: schema.trades.strategyId,
          symbol: schema.trades.symbol,
          side: schema.trades.side,
          quantity: schema.trades.quantity,
          entryPrice: schema.trades.entryPrice,
          exitPrice: schema.trades.exitPrice,
          entryDate: schema.trades.entryDate,
          exitDate: schema.trades.exitDate,
          pnl: schema.trades.pnl,
          fees: schema.trades.fees,
          netPnl: schema.trades.netPnl,
          status: schema.trades.status,
          notes: schema.trades.notes,
          createdAt: schema.trades.createdAt,
          updatedAt: schema.trades.updatedAt,
          accountName: schema.accounts.name,
        })
        .from(schema.trades)
        .leftJoin(schema.accounts, eq(schema.trades.accountId, schema.accounts.id))
        .where(and(...conditions))
        .orderBy(desc(schema.trades.entryDate));

      return attachTagsToTrades(trades);
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const [trade] = await db
        .select({
          id: schema.trades.id,
          userId: schema.trades.userId,
          accountId: schema.trades.accountId,
          strategyId: schema.trades.strategyId,
          symbol: schema.trades.symbol,
          side: schema.trades.side,
          quantity: schema.trades.quantity,
          entryPrice: schema.trades.entryPrice,
          exitPrice: schema.trades.exitPrice,
          entryDate: schema.trades.entryDate,
          exitDate: schema.trades.exitDate,
          pnl: schema.trades.pnl,
          fees: schema.trades.fees,
          netPnl: schema.trades.netPnl,
          status: schema.trades.status,
          notes: schema.trades.notes,
          createdAt: schema.trades.createdAt,
          updatedAt: schema.trades.updatedAt,
          // account inline
          accountName: schema.accounts.name,
          accountBroker: schema.accounts.broker,
          accountColor: schema.accounts.color,
          // strategy inline
          strategyName: schema.strategies.name,
          strategyColor: schema.strategies.color,
        })
        .from(schema.trades)
        .leftJoin(schema.accounts, eq(schema.trades.accountId, schema.accounts.id))
        .leftJoin(schema.strategies, eq(schema.trades.strategyId, schema.strategies.id))
        .where(and(eq(schema.trades.id, input.id), eq(schema.trades.userId, userId)))
        .limit(1);

      if (!trade) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trade not found" });
      }

      const withTags = await attachTagsToTrades([trade]);
      const result = withTags[0];

      return {
        ...result,
        account: trade.accountId
          ? { id: trade.accountId, name: trade.accountName, broker: trade.accountBroker, color: trade.accountColor }
          : null,
        strategy: trade.strategyId
          ? { id: trade.strategyId, name: trade.strategyName, color: trade.strategyColor }
          : null,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        symbol: z.string().min(1).max(20),
        side: z.enum(["long", "short"]),
        quantity: z.number().optional().nullable(),
        entryPrice: z.number().optional().nullable(),
        exitPrice: z.number().optional().nullable(),
        entryDate: z.number().optional().nullable(),
        exitDate: z.number().optional().nullable(),
        pnl: z.number().optional().nullable(),
        fees: z.number().optional().nullable(),
        notes: z.string().max(1000).optional().nullable(),
        status: z.enum(["open", "closed"]).optional(),
        accountId: z.number().optional().nullable(),
        strategyId: z.number().optional().nullable(),
        tagIds: z.array(z.number()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      if (input.accountId) {
        // Verify account ownership
        const [acct] = await db
          .select({ id: schema.accounts.id })
          .from(schema.accounts)
          .where(and(eq(schema.accounts.id, input.accountId), eq(schema.accounts.userId, userId)))
          .limit(1);

        if (!acct) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
        }

        // Check per-account trade limit
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.trades)
          .where(eq(schema.trades.accountId, input.accountId));

        if (count >= LIMITS.TRADES_PER_ACCOUNT) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Trade limit per account reached (max ${LIMITS.TRADES_PER_ACCOUNT})`,
          });
        }
      }

      const netPnl = (input.pnl ?? 0) - (input.fees ?? 0);

      const [trade] = await db
        .insert(schema.trades)
        .values({
          userId,
          accountId: input.accountId ?? null,
          strategyId: input.strategyId ?? null,
          symbol: input.symbol.toUpperCase(),
          side: input.side,
          quantity: input.quantity ?? null,
          entryPrice: input.entryPrice ?? null,
          exitPrice: input.exitPrice ?? null,
          entryDate: input.entryDate ?? null,
          exitDate: input.exitDate ?? null,
          pnl: input.pnl ?? null,
          fees: input.fees ?? 0,
          netPnl,
          status: input.status ?? "open",
          notes: input.notes ?? null,
        })
        .returning();

      if (input.tagIds && input.tagIds.length > 0) {
        await db.insert(schema.tradeTags).values(
          input.tagIds.map((tagId) => ({ tradeId: trade.id, tagId }))
        );
      }

      const withTags = await attachTagsToTrades([trade]);
      return withTags[0];
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        symbol: z.string().min(1).max(20).optional(),
        side: z.enum(["long", "short"]).optional(),
        quantity: z.number().optional().nullable(),
        entryPrice: z.number().optional().nullable(),
        exitPrice: z.number().optional().nullable(),
        entryDate: z.number().optional().nullable(),
        exitDate: z.number().optional().nullable(),
        pnl: z.number().optional().nullable(),
        fees: z.number().optional().nullable(),
        notes: z.string().max(1000).optional().nullable(),
        status: z.enum(["open", "closed"]).optional(),
        accountId: z.number().optional().nullable(),
        strategyId: z.number().optional().nullable(),
        tagIds: z.array(z.number()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { id, tagIds, ...fields } = input;

      const [existing] = await db
        .select()
        .from(schema.trades)
        .where(and(eq(schema.trades.id, id), eq(schema.trades.userId, userId)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trade not found" });
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() };

      if (fields.symbol !== undefined) updateData.symbol = fields.symbol.toUpperCase();
      if (fields.side !== undefined) updateData.side = fields.side;
      if ("quantity" in fields) updateData.quantity = fields.quantity;
      if ("entryPrice" in fields) updateData.entryPrice = fields.entryPrice;
      if ("exitPrice" in fields) updateData.exitPrice = fields.exitPrice;
      if ("entryDate" in fields) updateData.entryDate = fields.entryDate;
      if ("exitDate" in fields) updateData.exitDate = fields.exitDate;
      if ("pnl" in fields) updateData.pnl = fields.pnl;
      if ("fees" in fields) updateData.fees = fields.fees;
      if ("notes" in fields) updateData.notes = fields.notes;
      if (fields.status !== undefined) updateData.status = fields.status;
      if ("accountId" in fields) updateData.accountId = fields.accountId;
      if ("strategyId" in fields) updateData.strategyId = fields.strategyId;

      // Recalculate netPnl using merged values
      const resolvedPnl = ("pnl" in fields ? fields.pnl : existing.pnl) ?? 0;
      const resolvedFees = ("fees" in fields ? fields.fees : existing.fees) ?? 0;
      updateData.netPnl = resolvedPnl - resolvedFees;

      const [updated] = await db
        .update(schema.trades)
        .set(updateData)
        .where(eq(schema.trades.id, id))
        .returning();

      if (tagIds !== undefined) {
        await db.delete(schema.tradeTags).where(eq(schema.tradeTags.tradeId, id));
        if (tagIds.length > 0) {
          await db.insert(schema.tradeTags).values(
            tagIds.map((tagId) => ({ tradeId: id, tagId }))
          );
        }
      }

      const withTags = await attachTagsToTrades([updated]);
      return withTags[0];
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const [existing] = await db
        .select({ id: schema.trades.id })
        .from(schema.trades)
        .where(and(eq(schema.trades.id, input.id), eq(schema.trades.userId, userId)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trade not found" });
      }

      await db.delete(schema.trades).where(eq(schema.trades.id, input.id));

      return { ok: true };
    }),

  deleteBulk: protectedProcedure
    .input(z.object({ ids: z.array(z.number()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const owned = await db
        .select({ id: schema.trades.id })
        .from(schema.trades)
        .where(and(eq(schema.trades.userId, userId), inArray(schema.trades.id, input.ids)));

      if (owned.length !== input.ids.length) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "One or more trades not found or not owned by you",
        });
      }

      await db
        .delete(schema.trades)
        .where(inArray(schema.trades.id, input.ids));

      return { deleted: input.ids.length };
    }),

  bulkAssignTags: protectedProcedure
    .input(
      z.object({
        tradeIds: z.array(z.number()).min(1),
        addTagIds: z.array(z.number()).optional().default([]),
        removeTagIds: z.array(z.number()).optional().default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Verify ownership
      const owned = await db
        .select({ id: schema.trades.id })
        .from(schema.trades)
        .where(and(eq(schema.trades.userId, userId), inArray(schema.trades.id, input.tradeIds)));

      const ownedIds = owned.map((t) => t.id);
      if (ownedIds.length === 0) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No trades found" });
      }

      // Remove specified tags from these trades
      if (input.removeTagIds.length > 0) {
        await db
          .delete(schema.tradeTags)
          .where(
            and(
              inArray(schema.tradeTags.tradeId, ownedIds),
              inArray(schema.tradeTags.tagId, input.removeTagIds)
            )
          );
      }

      // Add specified tags — delete existing first to avoid duplicates, then insert
      if (input.addTagIds.length > 0) {
        await db
          .delete(schema.tradeTags)
          .where(
            and(
              inArray(schema.tradeTags.tradeId, ownedIds),
              inArray(schema.tradeTags.tagId, input.addTagIds)
            )
          );

        const newRows: Array<{ tradeId: number; tagId: number }> = [];
        for (const tradeId of ownedIds) {
          for (const tagId of input.addTagIds) {
            newRows.push({ tradeId, tagId });
          }
        }
        await db.insert(schema.tradeTags).values(newRows);
      }

      return { updated: ownedIds.length };
    }),

  importCSV: protectedProcedure
    .input(
      z.object({
        rows: z.array(
          z.object({
            symbol: z.string(),
            side: z.string(),
            entryPrice: z.union([z.string(), z.number()]).optional().nullable(),
            exitPrice: z.union([z.string(), z.number()]).optional().nullable(),
            entryDate: z.union([z.string(), z.number()]).optional().nullable(),
            exitDate: z.union([z.string(), z.number()]).optional().nullable(),
            quantity: z.union([z.string(), z.number()]).optional().nullable(),
            pnl: z.union([z.string(), z.number()]).optional().nullable(),
            fees: z.union([z.string(), z.number()]).optional().nullable(),
            notes: z.string().optional().nullable(),
          })
        ),
        accountId: z.number().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

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

      let imported = 0;
      let skipped = 0;

      const toInsert: Array<Parameters<typeof db.insert>[0] extends (...args: infer A) => unknown ? never : never> = [];

      const values: Array<{
        userId: number;
        accountId: number | null;
        symbol: string;
        side: "long" | "short";
        entryPrice: number | null;
        exitPrice: number | null;
        entryDate: number | null;
        exitDate: number | null;
        quantity: number | null;
        pnl: number | null;
        fees: number;
        netPnl: number;
        notes: string | null;
        status: "open" | "closed";
      }> = [];

      for (const row of input.rows) {
        const symbol = String(row.symbol ?? "").trim().toUpperCase();
        const sideRaw = String(row.side ?? "").trim().toLowerCase();

        if (!symbol || (sideRaw !== "long" && sideRaw !== "short")) {
          skipped++;
          continue;
        }

        const parseNum = (v: string | number | null | undefined): number | null => {
          if (v === null || v === undefined || v === "") return null;
          const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
          return isNaN(n) ? null : n;
        };

        const parseDateField = (v: string | number | null | undefined): number | null => {
          if (v === null || v === undefined || v === "") return null;
          if (typeof v === "number") return v;
          return parseDate(v);
        };

        const pnl = parseNum(row.pnl);
        const fees = parseNum(row.fees) ?? 0;
        const netPnl = (pnl ?? 0) - fees;
        const entryDate = parseDateField(row.entryDate);
        const exitDate = parseDateField(row.exitDate);

        values.push({
          userId,
          accountId: input.accountId ?? null,
          symbol,
          side: sideRaw as "long" | "short",
          entryPrice: parseNum(row.entryPrice),
          exitPrice: parseNum(row.exitPrice),
          entryDate,
          exitDate,
          quantity: parseNum(row.quantity),
          pnl,
          fees,
          netPnl,
          notes: row.notes ? String(row.notes).slice(0, 1000) : null,
          status: exitDate ? "closed" : "open",
        });
      }

      if (values.length > 0) {
        await db.insert(schema.trades).values(values);
        imported = values.length;
      }

      skipped += input.rows.length - values.length - skipped;

      return { imported, skipped };
    }),
});
