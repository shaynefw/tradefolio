// tRPC router for the Backtesting product area. Owns datasets and their
// trade rows. Completely separate from the live trade router — no cross-table
// joins, no shared state.

import { z } from "zod";
import { and, asc, desc, eq, max, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc.js";
import { db, schema } from "../db.js";

// ---------------------------------------------------------------------------
// Shared validators
// ---------------------------------------------------------------------------

const sideEnum = z.enum(["LONG", "SHORT"]);
const outcomeEnum = z.enum(["Took Profit", "Took Loss"]);
const recoveryEnum = z.enum(["none", "first", "second"]);

// Trade input shared by create + bulkInsert + update (with partials below).
const tradeInputShape = {
  date: z.number(), // ms since epoch
  time: z.string().default(""),
  side: sideEnum,
  tradeNo: z.number().int().min(0).default(0),
  validEntry: z.boolean().default(true),
  outcome: outcomeEnum.nullable().optional(),
  mae: z.number().nullable().optional(),
  mfe: z.number().nullable().optional(),
  recoveryStage: recoveryEnum.default("none"),
  premiumPnl: z.number().nullable().optional(),
  premiumBalance: z.number().nullable().optional(),
  premiumLabel: z.string().nullable().optional(),
  speedPnl: z.number().nullable().optional(),
  speedBalance: z.number().nullable().optional(),
  speedLabel: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
};

const tradeCreateInput = z.object(tradeInputShape);
const tradePatchInput = z.object({
  date: z.number().optional(),
  time: z.string().optional(),
  side: sideEnum.optional(),
  tradeNo: z.number().int().min(0).optional(),
  validEntry: z.boolean().optional(),
  outcome: outcomeEnum.nullable().optional(),
  mae: z.number().nullable().optional(),
  mfe: z.number().nullable().optional(),
  recoveryStage: recoveryEnum.optional(),
  premiumPnl: z.number().nullable().optional(),
  premiumBalance: z.number().nullable().optional(),
  premiumLabel: z.string().nullable().optional(),
  speedPnl: z.number().nullable().optional(),
  speedBalance: z.number().nullable().optional(),
  speedLabel: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getOwnedDataset(userId: number, datasetId: number) {
  const [ds] = await db
    .select()
    .from(schema.backtestDatasets)
    .where(
      and(
        eq(schema.backtestDatasets.id, datasetId),
        eq(schema.backtestDatasets.userId, userId),
      ),
    )
    .limit(1);
  if (!ds) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Dataset not found" });
  }
  return ds;
}

async function nextSequenceIdx(datasetId: number): Promise<number> {
  const [row] = await db
    .select({ m: max(schema.backtestTrades.sequenceIdx) })
    .from(schema.backtestTrades)
    .where(eq(schema.backtestTrades.datasetId, datasetId));
  return (row?.m ?? -1) + 1;
}

// ---------------------------------------------------------------------------
// Dataset procedures
// ---------------------------------------------------------------------------

const datasetRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        id: schema.backtestDatasets.id,
        name: schema.backtestDatasets.name,
        brickPoints: schema.backtestDatasets.brickPoints,
        stopBricks: schema.backtestDatasets.stopBricks,
        takeProfitBricks: schema.backtestDatasets.takeProfitBricks,
        createdAt: schema.backtestDatasets.createdAt,
        updatedAt: schema.backtestDatasets.updatedAt,
        tradeCount: sql<number>`(
          SELECT COUNT(*) FROM ${schema.backtestTrades}
          WHERE ${schema.backtestTrades.datasetId} = ${schema.backtestDatasets.id}
        )`,
      })
      .from(schema.backtestDatasets)
      .where(eq(schema.backtestDatasets.userId, ctx.user.id))
      .orderBy(desc(schema.backtestDatasets.updatedAt));
    return rows;
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        brickPoints: z.number().int().positive().default(20),
        stopBricks: z.number().int().positive().default(8),
        takeProfitBricks: z.number().int().positive().default(2),
        // Optional seed trades — used by "Load MNQ sample" flow. The whole
        // create-and-seed runs in one transaction so partial failures don't
        // leave an empty dataset around.
        seedTrades: z.array(tradeCreateInput).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return await db.transaction(async (tx) => {
        const [ds] = await tx
          .insert(schema.backtestDatasets)
          .values({
            userId: ctx.user.id,
            name: input.name,
            brickPoints: input.brickPoints,
            stopBricks: input.stopBricks,
            takeProfitBricks: input.takeProfitBricks,
          })
          .returning();
        if (input.seedTrades && input.seedTrades.length > 0) {
          const rows = input.seedTrades.map((t, i) => ({
            ...t,
            datasetId: ds.id,
            sequenceIdx: i,
          }));
          await tx.insert(schema.backtestTrades).values(rows);
        }
        return ds;
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(100).optional(),
        brickPoints: z.number().int().positive().optional(),
        stopBricks: z.number().int().positive().optional(),
        takeProfitBricks: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await getOwnedDataset(ctx.user.id, input.id);
      const { id, ...patch } = input;
      const [updated] = await db
        .update(schema.backtestDatasets)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(schema.backtestDatasets.id, id))
        .returning();
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await getOwnedDataset(ctx.user.id, input.id);
      await db
        .delete(schema.backtestDatasets)
        .where(eq(schema.backtestDatasets.id, input.id));
      return { ok: true };
    }),
});

// ---------------------------------------------------------------------------
// Trade procedures
// ---------------------------------------------------------------------------

const tradeRouter = router({
  list: protectedProcedure
    .input(z.object({ datasetId: z.number() }))
    .query(async ({ ctx, input }) => {
      await getOwnedDataset(ctx.user.id, input.datasetId);
      const rows = await db
        .select()
        .from(schema.backtestTrades)
        .where(eq(schema.backtestTrades.datasetId, input.datasetId))
        .orderBy(asc(schema.backtestTrades.sequenceIdx));
      return rows;
    }),

  create: protectedProcedure
    .input(
      z.object({
        datasetId: z.number(),
        trade: tradeCreateInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await getOwnedDataset(ctx.user.id, input.datasetId);
      const sequenceIdx = await nextSequenceIdx(input.datasetId);
      const [created] = await db
        .insert(schema.backtestTrades)
        .values({
          ...input.trade,
          datasetId: input.datasetId,
          sequenceIdx,
        })
        .returning();
      return created;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        patch: tradePatchInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership by joining through the dataset.
      const [existing] = await db
        .select({
          id: schema.backtestTrades.id,
          datasetId: schema.backtestTrades.datasetId,
        })
        .from(schema.backtestTrades)
        .where(eq(schema.backtestTrades.id, input.id))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trade not found" });
      }
      await getOwnedDataset(ctx.user.id, existing.datasetId);
      const [updated] = await db
        .update(schema.backtestTrades)
        .set({ ...input.patch, updatedAt: new Date() })
        .where(eq(schema.backtestTrades.id, input.id))
        .returning();
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select({
          id: schema.backtestTrades.id,
          datasetId: schema.backtestTrades.datasetId,
        })
        .from(schema.backtestTrades)
        .where(eq(schema.backtestTrades.id, input.id))
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trade not found" });
      }
      await getOwnedDataset(ctx.user.id, existing.datasetId);
      await db
        .delete(schema.backtestTrades)
        .where(eq(schema.backtestTrades.id, input.id));
      return { ok: true };
    }),

  // Append many trades to an existing dataset (for CSV upload in Phase 2).
  bulkInsert: protectedProcedure
    .input(
      z.object({
        datasetId: z.number(),
        trades: z.array(tradeCreateInput).min(1).max(10_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await getOwnedDataset(ctx.user.id, input.datasetId);
      const baseIdx = await nextSequenceIdx(input.datasetId);
      const rows = input.trades.map((t, i) => ({
        ...t,
        datasetId: input.datasetId,
        sequenceIdx: baseIdx + i,
      }));
      await db.insert(schema.backtestTrades).values(rows);
      return { inserted: rows.length };
    }),
});

// ---------------------------------------------------------------------------
// Combined router
// ---------------------------------------------------------------------------

export const backtestRouter = router({
  dataset: datasetRouter,
  trade: tradeRouter,
});
