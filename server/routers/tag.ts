import { z } from "zod";
import { eq, and, asc, sql, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc.js";
import { db, schema } from "../db.js";
import { LIMITS } from "../../shared/types.js";

export const tagRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    const rows = await db
      .select({
        id: schema.tags.id,
        userId: schema.tags.userId,
        name: schema.tags.name,
        color: schema.tags.color,
        createdAt: schema.tags.createdAt,
        usageCount: sql<number>`(
          SELECT COUNT(*) FROM trade_tags WHERE trade_tags.tag_id = ${schema.tags.id}
        )`.as("usage_count"),
      })
      .from(schema.tags)
      .where(eq(schema.tags.userId, userId))
      .orderBy(asc(schema.tags.name));

    return rows;
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(50),
        color: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.tags)
        .where(eq(schema.tags.userId, userId));

      if (count >= LIMITS.TAGS_PER_USER) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Tag limit reached (max ${LIMITS.TAGS_PER_USER})`,
        });
      }

      const [tag] = await db
        .insert(schema.tags)
        .values({
          userId,
          name: input.name,
          color: input.color ?? "#6366f1",
        })
        .returning();

      return tag;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(50).optional(),
        color: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { id, ...fields } = input;

      const [existing] = await db
        .select({ id: schema.tags.id })
        .from(schema.tags)
        .where(and(eq(schema.tags.id, id), eq(schema.tags.userId, userId)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tag not found" });
      }

      const updateData: Record<string, unknown> = {};
      if (fields.name !== undefined) updateData.name = fields.name;
      if ("color" in fields) updateData.color = fields.color;

      const [updated] = await db
        .update(schema.tags)
        .set(updateData)
        .where(eq(schema.tags.id, id))
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const [existing] = await db
        .select({ id: schema.tags.id })
        .from(schema.tags)
        .where(and(eq(schema.tags.id, input.id), eq(schema.tags.userId, userId)))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tag not found" });
      }

      // trade_tags cascade deletes via FK constraint
      await db.delete(schema.tags).where(eq(schema.tags.id, input.id));

      return { ok: true };
    }),

  setForTrade: protectedProcedure
    .input(
      z.object({
        tradeId: z.number(),
        tagIds: z.array(z.number()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Verify trade ownership
      const [trade] = await db
        .select({ id: schema.trades.id })
        .from(schema.trades)
        .where(and(eq(schema.trades.id, input.tradeId), eq(schema.trades.userId, userId)))
        .limit(1);

      if (!trade) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trade not found" });
      }

      // Verify all requested tags belong to this user
      if (input.tagIds.length > 0) {
        const userTags = await db
          .select({ id: schema.tags.id })
          .from(schema.tags)
          .where(and(eq(schema.tags.userId, userId), inArray(schema.tags.id, input.tagIds)));

        if (userTags.length !== input.tagIds.length) {
          throw new TRPCError({ code: "FORBIDDEN", message: "One or more tags not found" });
        }
      }

      // Delete all existing trade_tags for this trade
      await db
        .delete(schema.tradeTags)
        .where(eq(schema.tradeTags.tradeId, input.tradeId));

      // Insert new trade_tags
      if (input.tagIds.length > 0) {
        await db.insert(schema.tradeTags).values(
          input.tagIds.map((tagId) => ({ tradeId: input.tradeId, tagId }))
        );
      }

      return { ok: true };
    }),
});
