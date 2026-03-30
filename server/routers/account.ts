import { z } from "zod";
import { eq, and, asc, desc, sql } from "drizzle-orm";
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
          SELECT COUNT(*) FROM trades WHERE trades.account_id = ${schema.accounts.id}
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

      await db.delete(schema.accounts).where(eq(schema.accounts.id, input.id));

      return { ok: true };
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
