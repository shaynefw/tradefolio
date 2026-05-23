import { z } from "zod";
import { eq, and, asc, desc, sql, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc.js";
import { db, schema } from "../db.js";
import { LIMITS } from "../../shared/types.js";

export const accountRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    const rows = await db
      .select({
        id: schema.accounts.id,
        userId: schema.accounts.userId,
        name: schema.accounts.name,
        broker: schema.accounts.broker,
        accountNumber: schema.accounts.accountNumber,
        description: schema.accounts.description,
        color: schema.accounts.color,
        isDefault: schema.accounts.isDefault,
        createdAt: schema.accounts.createdAt,
        updatedAt: schema.accounts.updatedAt,
        tradeCount: sql<number>`(
          SELECT COUNT(*) FROM trades WHERE trades.account_id = accounts.id AND trades.user_id = ${userId}
        )`.as("trade_count"),
      })
      .from(schema.accounts)
      .where(eq(schema.accounts.userId, userId))
      .orderBy(desc(schema.accounts.isDefault), asc(schema.accounts.name));

    return rows;
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        broker: z.string().optional(),
        accountNumber: z.string().optional(),
        description: z.string().optional(),
        color: z.string().optional(),
        isDefault: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.accounts)
        .where(eq(schema.accounts.userId, userId));

      if (count >= LIMITS.ACCOUNTS_PER_USER) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Account limit reached (max ${LIMITS.ACCOUNTS_PER_USER})`,
        });
      }

      if (input.isDefault) {
        await db
          .update(schema.accounts)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(schema.accounts.userId, userId));
      }

      const [account] = await db
        .insert(schema.accounts)
        .values({
          userId,
          name: input.name,
          broker: input.broker ?? null,
          accountNumber: input.accountNumber ?? null,
          description: input.description ?? null,
          color: input.color ?? "#6366f1",
          isDefault: input.isDefault ?? false,
        })
        .returning();

      return account;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(100).optional(),
        broker: z.string().optional().nullable(),
        accountNumber: z.string().optional().nullable(),
        description: z.string().optional().nullable(),
        color: z.string().optional().nullable(),
        isDefault: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { id, ...fields } = input;

      const [existing] = await db
        .select({ id: schema.accounts.id, userId: schema.accounts.userId })
        .from(schema.accounts)
        .where(and(eq(schema.accounts.id, id), eq(schema.accounts.userId, userId)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      }

      if (fields.isDefault) {
        await db
          .update(schema.accounts)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(schema.accounts.userId, userId));
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (fields.name !== undefined) updateData.name = fields.name;
      if ("broker" in fields) updateData.broker = fields.broker;
      if ("accountNumber" in fields) updateData.accountNumber = fields.accountNumber;
      if ("description" in fields) updateData.description = fields.description;
      if ("color" in fields) updateData.color = fields.color;
      if (fields.isDefault !== undefined) updateData.isDefault = fields.isDefault;

      const [updated] = await db
        .update(schema.accounts)
        .set(updateData)
        .where(eq(schema.accounts.id, id))
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        // When true, all trades attached to this account are deleted too.
        // When false/omitted, trades are kept and their accountId is nulled
        // out by the existing ON DELETE SET NULL FK.
        deleteTrades: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const [existing] = await db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(and(eq(schema.accounts.id, input.id), eq(schema.accounts.userId, userId)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      }

      let tradesDeleted = 0;
      if (input.deleteTrades) {
        // Scope to the user too, just in case — defence against a stale accountId.
        const deletedRows = await db
          .delete(schema.trades)
          .where(
            and(
              eq(schema.trades.accountId, input.id),
              eq(schema.trades.userId, userId)
            )
          )
          .returning({ id: schema.trades.id });
        tradesDeleted = deletedRows.length;
      }

      await db.delete(schema.accounts).where(eq(schema.accounts.id, input.id));

      return { ok: true, tradesDeleted };
    }),

  // Delete multiple accounts at once, optionally wiping their trades too.
  // Scoped to the calling user, so a stale or hostile id can't reach another
  // user's accounts.
  deleteBulk: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.number()).min(1),
        deleteTrades: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Restrict to accounts the user actually owns.
      const owned = await db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(
          and(
            inArray(schema.accounts.id, input.ids),
            eq(schema.accounts.userId, userId)
          )
        );
      const ownedIds = owned.map((a) => a.id);
      if (ownedIds.length === 0) {
        return { accountsDeleted: 0, tradesDeleted: 0 };
      }

      let tradesDeleted = 0;
      if (input.deleteTrades) {
        const deletedRows = await db
          .delete(schema.trades)
          .where(
            and(
              inArray(schema.trades.accountId, ownedIds),
              eq(schema.trades.userId, userId)
            )
          )
          .returning({ id: schema.trades.id });
        tradesDeleted = deletedRows.length;
      }

      await db
        .delete(schema.accounts)
        .where(
          and(
            inArray(schema.accounts.id, ownedIds),
            eq(schema.accounts.userId, userId)
          )
        );

      return { accountsDeleted: ownedIds.length, tradesDeleted };
    }),

  setDefault: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const [existing] = await db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(and(eq(schema.accounts.id, input.id), eq(schema.accounts.userId, userId)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      }

      await db
        .update(schema.accounts)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(schema.accounts.userId, userId));

      const [updated] = await db
        .update(schema.accounts)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(schema.accounts.id, input.id))
        .returning();

      return updated;
    }),
});
