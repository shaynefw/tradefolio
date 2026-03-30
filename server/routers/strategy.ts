import { z } from "zod";
import { eq, and, asc, sql, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc.js";
import { db, schema } from "../db.js";
import { LIMITS } from "../../shared/types.js";

export const strategyRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    const rows = await db
      .select()
      .from(schema.strategies)
      .where(eq(schema.strategies.userId, userId))
      .orderBy(asc(schema.strategies.name));

    return rows;
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().optional(),
        color: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.strategies)
        .where(eq(schema.strategies.userId, userId));

      if (count >= LIMITS.STRATEGIES_PER_USER) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Strategy limit reached (max ${LIMITS.STRATEGIES_PER_USER})`,
        });
      }

      const [strategy] = await db
        .insert(schema.strategies)
        .values({
          userId,
          name: input.name,
          description: input.description ?? null,
          color: input.color ?? "#6366f1",
        })
        .returning();

      return strategy;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().optional().nullable(),
        color: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { id, ...fields } = input;

      const [existing] = await db
        .select({ id: schema.strategies.id })
        .from(schema.strategies)
        .where(and(eq(schema.strategies.id, id), eq(schema.strategies.userId, userId)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Strategy not found" });
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (fields.name !== undefined) updateData.name = fields.name;
      if ("description" in fields) updateData.description = fields.description;
      if ("color" in fields) updateData.color = fields.color;

      const [updated] = await db
        .update(schema.strategies)
        .set(updateData)
        .where(eq(schema.strategies.id, id))
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const [existing] = await db
        .select({ id: schema.strategies.id })
        .from(schema.strategies)
        .where(and(eq(schema.strategies.id, input.id), eq(schema.strategies.userId, userId)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Strategy not found" });
      }

      // Null out strategyId on affected trades before deleting
      await db
        .update(schema.trades)
        .set({ strategyId: null, updatedAt: new Date() })
        .where(eq(schema.trades.strategyId, input.id));

      await db.delete(schema.strategies).where(eq(schema.strategies.id, input.id));

      return { ok: true };
    }),
});
