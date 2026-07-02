// tRPC router for the Backtesting product area. Owns datasets and their
// trade rows. Completely separate from the live trade router — no cross-table
// joins, no shared state.

import { z } from "zod";
import { and, asc, desc, eq, max, ne, sql } from "drizzle-orm";
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
  premiumResetBalance: z.number().nullable().optional(),
  speedPnl: z.number().nullable().optional(),
  speedBalance: z.number().nullable().optional(),
  speedLabel: z.string().nullable().optional(),
  speedResetBalance: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  isPending: z.boolean().default(false),
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
  premiumResetBalance: z.number().nullable().optional(),
  speedPnl: z.number().nullable().optional(),
  speedBalance: z.number().nullable().optional(),
  speedLabel: z.string().nullable().optional(),
  speedResetBalance: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  isPending: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Ensures no other dataset owned by this user has the same name. Pass
// excludeId to allow rename-in-place (the current row is skipped from the
// duplicate check). Throws a CONFLICT tRPC error so the client can surface
// the collision cleanly.
async function assertUniqueName(
  userId: number,
  name: string,
  excludeId?: number,
) {
  const conditions = [
    eq(schema.backtestDatasets.userId, userId),
    eq(schema.backtestDatasets.name, name),
  ];
  if (excludeId != null) {
    conditions.push(ne(schema.backtestDatasets.id, excludeId));
  }
  const [existing] = await db
    .select({ id: schema.backtestDatasets.id })
    .from(schema.backtestDatasets)
    .where(and(...conditions))
    .limit(1);
  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `A dataset named "${name}" already exists`,
    });
  }
}

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
        premiumStartBalance: schema.backtestDatasets.premiumStartBalance,
        speedStartBalance: schema.backtestDatasets.speedStartBalance,
        notes: schema.backtestDatasets.notes,
        rrBuckets: schema.backtestDatasets.rrBuckets,
        premiumScalingSchedule: schema.backtestDatasets.premiumScalingSchedule,
        speedScalingSchedule: schema.backtestDatasets.speedScalingSchedule,
        createdAt: schema.backtestDatasets.createdAt,
        updatedAt: schema.backtestDatasets.updatedAt,
        // Subquery counted via raw SQL — drizzle's sql template wasn't
        // rendering the table reference inside the COUNT correctly.
        tradeCount: sql<number>`(SELECT COUNT(*) FROM backtest_trades WHERE backtest_trades.dataset_id = backtest_datasets.id)`,
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
        premiumStartBalance: z.number().nullable().optional(),
        speedStartBalance: z.number().nullable().optional(),
        notes: z.string().nullable().optional(),
        rrBuckets: z.string().nullable().optional(),
        premiumScalingSchedule: z.string().nullable().optional(),
        speedScalingSchedule: z.string().nullable().optional(),
        // Optional seed trades — used by "Load MNQ sample" flow. The whole
        // create-and-seed runs in one transaction so partial failures don't
        // leave an empty dataset around.
        seedTrades: z.array(tradeCreateInput).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertUniqueName(ctx.user.id, input.name);
      return await db.transaction(async (tx) => {
        const [ds] = await tx
          .insert(schema.backtestDatasets)
          .values({
            userId: ctx.user.id,
            name: input.name,
            brickPoints: input.brickPoints,
            stopBricks: input.stopBricks,
            takeProfitBricks: input.takeProfitBricks,
            premiumStartBalance: input.premiumStartBalance ?? null,
            speedStartBalance: input.speedStartBalance ?? null,
            notes: input.notes ?? null,
            rrBuckets: input.rrBuckets ?? null,
            premiumScalingSchedule: input.premiumScalingSchedule ?? null,
            speedScalingSchedule: input.speedScalingSchedule ?? null,
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
        premiumStartBalance: z.number().nullable().optional(),
        speedStartBalance: z.number().nullable().optional(),
        notes: z.string().nullable().optional(),
        rrBuckets: z.string().nullable().optional(),
        premiumScalingSchedule: z.string().nullable().optional(),
        speedScalingSchedule: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await getOwnedDataset(ctx.user.id, input.id);
      if (input.name != null) {
        await assertUniqueName(ctx.user.id, input.name, input.id);
      }
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

  // Full backup: dataset config + all trades, ready to serialize to JSON on
  // the client. Kept as a query (idempotent, cacheable) since it just reads.
  exportBackup: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const ds = await getOwnedDataset(ctx.user.id, input.id);
      const trades = await db
        .select()
        .from(schema.backtestTrades)
        .where(eq(schema.backtestTrades.datasetId, input.id))
        .orderBy(asc(schema.backtestTrades.sequenceIdx));
      return {
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        dataset: {
          name: ds.name,
          brickPoints: ds.brickPoints,
          stopBricks: ds.stopBricks,
          takeProfitBricks: ds.takeProfitBricks,
          premiumStartBalance: ds.premiumStartBalance,
          speedStartBalance: ds.speedStartBalance,
          notes: ds.notes,
          rrBuckets: ds.rrBuckets,
          premiumScalingSchedule: ds.premiumScalingSchedule,
          speedScalingSchedule: ds.speedScalingSchedule,
        },
        trades: trades.map((t) => ({
          date: t.date,
          time: t.time,
          side: t.side,
          tradeNo: t.tradeNo,
          validEntry: t.validEntry,
          outcome: t.outcome,
          mae: t.mae,
          mfe: t.mfe,
          recoveryStage: t.recoveryStage,
          premiumPnl: t.premiumPnl,
          premiumBalance: t.premiumBalance,
          premiumLabel: t.premiumLabel,
          premiumResetBalance: t.premiumResetBalance,
          speedPnl: t.speedPnl,
          speedBalance: t.speedBalance,
          speedLabel: t.speedLabel,
          speedResetBalance: t.speedResetBalance,
          notes: t.notes,
          isPending: t.isPending,
        })),
      };
    }),

  // Restore from a backup payload. Rejects if the name would collide with
  // another dataset the user owns — the client surfaces the CONFLICT so the
  // user can rename before re-uploading. Whole operation runs in a txn.
  importBackup: protectedProcedure
    .input(
      z.object({
        backup: z.object({
          version: z.literal(1),
          dataset: z.object({
            name: z.string().min(1).max(100),
            brickPoints: z.number().int().positive(),
            stopBricks: z.number().int().positive(),
            takeProfitBricks: z.number().int().positive(),
            premiumStartBalance: z.number().nullable(),
            speedStartBalance: z.number().nullable(),
            notes: z.string().nullable(),
            rrBuckets: z.string().nullable(),
            premiumScalingSchedule: z.string().nullable().optional(),
            speedScalingSchedule: z.string().nullable().optional(),
          }),
          trades: z.array(tradeCreateInput),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { dataset, trades } = input.backup;
      await assertUniqueName(ctx.user.id, dataset.name);
      return await db.transaction(async (tx) => {
        const [ds] = await tx
          .insert(schema.backtestDatasets)
          .values({
            userId: ctx.user.id,
            name: dataset.name,
            brickPoints: dataset.brickPoints,
            stopBricks: dataset.stopBricks,
            takeProfitBricks: dataset.takeProfitBricks,
            premiumStartBalance: dataset.premiumStartBalance,
            speedStartBalance: dataset.speedStartBalance,
            notes: dataset.notes,
            rrBuckets: dataset.rrBuckets,
            premiumScalingSchedule: dataset.premiumScalingSchedule ?? null,
            speedScalingSchedule: dataset.speedScalingSchedule ?? null,
          })
          .returning();
        if (trades.length > 0) {
          await tx.insert(schema.backtestTrades).values(
            trades.map((t, i) => ({
              ...t,
              datasetId: ds.id,
              sequenceIdx: i,
            })),
          );
        }
        return { dataset: ds, importedTrades: trades.length };
      });
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
