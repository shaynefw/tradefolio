import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";

import { router, protectedProcedure, publicProcedure } from "../trpc.js";
import { db, schema } from "../db.js";

// ---------------------------------------------------------------------------
// Investor ledger.
//
// Everything a client sees is derived pro-rata from their share of the month's
// capital, so the owner only ever edits three numbers per month: each
// investor's contribution, the fund's net profit, and the fund's fees.
//
//   weight = contribution / Σ contributions
//   gross  = weight × totalProfit
//   fee    = weight × totalFees
//   net    = gross − fee
//
// Derivation lives on the client (shared with the read-only view) so the
// server stays a plain store.
// ---------------------------------------------------------------------------

async function getOwnedFund(userId: number, fundId: number) {
  const [fund] = await db
    .select()
    .from(schema.investorFunds)
    .where(
      and(
        eq(schema.investorFunds.id, fundId),
        eq(schema.investorFunds.userId, userId),
      ),
    )
    .limit(1);
  if (!fund) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Fund not found" });
  }
  return fund;
}

// Loads a fund's investors, periods and entries in one shot — the whole book
// is small (a handful of investors × 12 months a year), so paging would add
// complexity for no benefit.
async function loadBook(fundId: number) {
  const investors = await db
    .select()
    .from(schema.investors)
    .where(eq(schema.investors.fundId, fundId))
    .orderBy(asc(schema.investors.sortIdx), asc(schema.investors.id));

  const periods = await db
    .select()
    .from(schema.investorPeriods)
    .where(eq(schema.investorPeriods.fundId, fundId))
    .orderBy(asc(schema.investorPeriods.year), asc(schema.investorPeriods.month));

  const periodIds = periods.map((p) => p.id);
  const entries = periodIds.length
    ? await db
        .select()
        .from(schema.investorEntries)
        .where(inArray(schema.investorEntries.periodId, periodIds))
    : [];

  return { investors, periods, entries };
}

export const investorRouter = router({
  // --- funds ---------------------------------------------------------------
  listFunds: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select()
      .from(schema.investorFunds)
      .where(eq(schema.investorFunds.userId, ctx.user.id))
      .orderBy(asc(schema.investorFunds.id));
  }),

  createFund: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [fund] = await db
        .insert(schema.investorFunds)
        .values({
          userId: ctx.user.id,
          name: input.name,
          notes: input.notes ?? null,
        })
        .returning();
      return fund;
    }),

  updateFund: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(100).optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await getOwnedFund(ctx.user.id, input.id);
      const { id, ...patch } = input;
      const [updated] = await db
        .update(schema.investorFunds)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(schema.investorFunds.id, id))
        .returning();
      return updated;
    }),

  deleteFund: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await getOwnedFund(ctx.user.id, input.id);
      await db
        .delete(schema.investorFunds)
        .where(eq(schema.investorFunds.id, input.id));
      return { ok: true };
    }),

  // Full book for one fund — investors, every month, every contribution.
  getBook: protectedProcedure
    .input(z.object({ fundId: z.number() }))
    .query(async ({ ctx, input }) => {
      const fund = await getOwnedFund(ctx.user.id, input.fundId);
      return { fund, ...(await loadBook(fund.id)) };
    }),

  // --- investors -----------------------------------------------------------
  addInvestor: protectedProcedure
    .input(
      z.object({
        fundId: z.number(),
        name: z.string().min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await getOwnedFund(ctx.user.id, input.fundId);
      const existing = await db
        .select({ id: schema.investors.id })
        .from(schema.investors)
        .where(eq(schema.investors.fundId, input.fundId));
      const [inv] = await db
        .insert(schema.investors)
        .values({
          fundId: input.fundId,
          name: input.name,
          sortIdx: existing.length,
        })
        .returning();
      return inv;
    }),

  updateInvestor: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(100).optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [inv] = await db
        .select()
        .from(schema.investors)
        .where(eq(schema.investors.id, input.id))
        .limit(1);
      if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
      await getOwnedFund(ctx.user.id, inv.fundId);
      const { id, ...patch } = input;
      const [updated] = await db
        .update(schema.investors)
        .set(patch)
        .where(eq(schema.investors.id, id))
        .returning();
      return updated;
    }),

  deleteInvestor: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [inv] = await db
        .select()
        .from(schema.investors)
        .where(eq(schema.investors.id, input.id))
        .limit(1);
      if (!inv) throw new TRPCError({ code: "NOT_FOUND" });
      await getOwnedFund(ctx.user.id, inv.fundId);
      await db.delete(schema.investors).where(eq(schema.investors.id, input.id));
      return { ok: true };
    }),

  // --- periods (months) ----------------------------------------------------
  // Creates the month if it doesn't exist. Optionally seeds each active
  // investor's contribution from the most recent prior month, so month-to-month
  // rollover is one click.
  addPeriod: protectedProcedure
    .input(
      z.object({
        fundId: z.number(),
        year: z.number().int().min(2000).max(2100),
        month: z.number().int().min(1).max(12),
        carryForward: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await getOwnedFund(ctx.user.id, input.fundId);
      const [dupe] = await db
        .select({ id: schema.investorPeriods.id })
        .from(schema.investorPeriods)
        .where(
          and(
            eq(schema.investorPeriods.fundId, input.fundId),
            eq(schema.investorPeriods.year, input.year),
            eq(schema.investorPeriods.month, input.month),
          ),
        )
        .limit(1);
      if (dupe) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "That month already exists in this book",
        });
      }

      const [period] = await db
        .insert(schema.investorPeriods)
        .values({
          fundId: input.fundId,
          year: input.year,
          month: input.month,
        })
        .returning();

      // Seed contributions: carry forward the latest prior month, else 0.
      const investors = await db
        .select()
        .from(schema.investors)
        .where(eq(schema.investors.fundId, input.fundId));
      const active = investors.filter((i) => i.active);
      if (active.length > 0) {
        let carried = new Map<number, number>();
        if (input.carryForward) {
          const priors = await db
            .select()
            .from(schema.investorPeriods)
            .where(eq(schema.investorPeriods.fundId, input.fundId))
            .orderBy(asc(schema.investorPeriods.year), asc(schema.investorPeriods.month));
          const before = priors.filter(
            (p) =>
              p.id !== period.id &&
              (p.year < input.year ||
                (p.year === input.year && p.month < input.month)),
          );
          const latest = before[before.length - 1];
          if (latest) {
            const rows = await db
              .select()
              .from(schema.investorEntries)
              .where(eq(schema.investorEntries.periodId, latest.id));
            carried = new Map(rows.map((r) => [r.investorId, r.contribution]));
          }
        }
        await db.insert(schema.investorEntries).values(
          active.map((i) => ({
            periodId: period.id,
            investorId: i.id,
            contribution: carried.get(i.id) ?? 0,
          })),
        );
      }
      return period;
    }),

  updatePeriod: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        totalProfit: z.number().optional(),
        totalFees: z.number().optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [p] = await db
        .select()
        .from(schema.investorPeriods)
        .where(eq(schema.investorPeriods.id, input.id))
        .limit(1);
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      await getOwnedFund(ctx.user.id, p.fundId);
      const { id, ...patch } = input;
      const [updated] = await db
        .update(schema.investorPeriods)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(schema.investorPeriods.id, id))
        .returning();
      return updated;
    }),

  deletePeriod: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [p] = await db
        .select()
        .from(schema.investorPeriods)
        .where(eq(schema.investorPeriods.id, input.id))
        .limit(1);
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      await getOwnedFund(ctx.user.id, p.fundId);
      await db
        .delete(schema.investorPeriods)
        .where(eq(schema.investorPeriods.id, input.id));
      return { ok: true };
    }),

  // --- contributions -------------------------------------------------------
  setContribution: protectedProcedure
    .input(
      z.object({
        periodId: z.number(),
        investorId: z.number(),
        contribution: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [p] = await db
        .select()
        .from(schema.investorPeriods)
        .where(eq(schema.investorPeriods.id, input.periodId))
        .limit(1);
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      await getOwnedFund(ctx.user.id, p.fundId);

      const [existing] = await db
        .select()
        .from(schema.investorEntries)
        .where(
          and(
            eq(schema.investorEntries.periodId, input.periodId),
            eq(schema.investorEntries.investorId, input.investorId),
          ),
        )
        .limit(1);

      if (existing) {
        const [updated] = await db
          .update(schema.investorEntries)
          .set({ contribution: input.contribution })
          .where(eq(schema.investorEntries.id, existing.id))
          .returning();
        return updated;
      }
      const [created] = await db
        .insert(schema.investorEntries)
        .values({
          periodId: input.periodId,
          investorId: input.investorId,
          contribution: input.contribution,
        })
        .returning();
      return created;
    }),

  // --- sharing -------------------------------------------------------------
  enableSharing: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const fund = await getOwnedFund(ctx.user.id, input.id);
      if (fund.shareToken) return { token: fund.shareToken };
      const token = randomBytes(24).toString("base64url");
      await db
        .update(schema.investorFunds)
        .set({ shareToken: token, updatedAt: new Date() })
        .where(eq(schema.investorFunds.id, input.id));
      return { token };
    }),

  disableSharing: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await getOwnedFund(ctx.user.id, input.id);
      await db
        .update(schema.investorFunds)
        .set({ shareToken: null, updatedAt: new Date() })
        .where(eq(schema.investorFunds.id, input.id));
      return { ok: true };
    }),

  // Public, unauthenticated read-only view for clients.
  getShared: publicProcedure
    .input(z.object({ token: z.string().min(10) }))
    .query(async ({ input }) => {
      const [fund] = await db
        .select()
        .from(schema.investorFunds)
        .where(eq(schema.investorFunds.shareToken, input.token))
        .limit(1);
      if (!fund) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This link is invalid or has been revoked.",
        });
      }
      const book = await loadBook(fund.id);
      // Never leak the owner's user id or the token itself.
      return {
        fund: { id: fund.id, name: fund.name, notes: fund.notes },
        ...book,
      };
    }),
});
