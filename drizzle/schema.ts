import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  role: text("role", { enum: ["user", "admin"] }).default("user").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  broker: text("broker"),
  accountNumber: text("account_number"),
  description: text("description"),
  color: text("color").default("#6366f1"),
  isDefault: integer("is_default", { mode: "boolean" }).default(false).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

export const strategies = sqliteTable("strategies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").default("#6366f1"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

export const trades = sqliteTable("trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: integer("account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  strategyId: integer("strategy_id").references(() => strategies.id, {
    onDelete: "set null",
  }),
  symbol: text("symbol").notNull(),
  side: text("side", { enum: ["long", "short"] }).notNull(),
  quantity: real("quantity"),
  entryPrice: real("entry_price"),
  exitPrice: real("exit_price"),
  entryDate: integer("entry_date"),
  exitDate: integer("exit_date"),
  pnl: real("pnl"),
  fees: real("fees").default(0),
  netPnl: real("net_pnl"),
  status: text("status", { enum: ["open", "closed"] }).default("open").notNull(),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").default("#6366f1"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

export const tradeTags = sqliteTable("trade_tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tradeId: integer("trade_id")
    .notNull()
    .references(() => trades.id, { onDelete: "cascade" }),
  tagId: integer("tag_id")
    .notNull()
    .references(() => tags.id, { onDelete: "cascade" }),
});

// ---------------------------------------------------------------------------
// Backtesting — completely isolated from the live trade tables above. Each
// user can own many named datasets; each dataset has many trade rows. The
// strategy parameters (brick size, stop/TP in bricks) live on the dataset so
// metric computations stay self-describing.
// ---------------------------------------------------------------------------

export const backtestDatasets = sqliteTable("backtest_datasets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  brickPoints: integer("brick_points").default(20).notNull(),
  stopBricks: integer("stop_bricks").default(8).notNull(),
  takeProfitBricks: integer("take_profit_bricks").default(2).notNull(),
  // "fixed" uses the brick TP/SL above; "fluid" derives the effective TP/SL
  // from the average realized points of winning / losing trades.
  tpMode: text("tp_mode", { enum: ["fixed", "fluid"] })
    .default("fixed")
    .notNull(),
  slMode: text("sl_mode", { enum: ["fixed", "fluid"] })
    .default("fixed")
    .notNull(),
  // Optional per-scaling starting balances. When set, the Scaling tab
  // computes a running balance from start + Σ pnl (honoring per-trade
  // resets); when null, that scaling is considered "not tracked".
  premiumStartBalance: real("premium_start_balance"),
  speedStartBalance: real("speed_start_balance"),
  // Free-form notes the user keeps about how this backtest is being
  // tracked — rules, entry criteria, special conventions, etc.
  notes: text("notes"),
  // User-customized RR buckets for the Timing tab's RR-bucket-reach table.
  // Stored as a JSON array of { tpPoints, stopPoints }; null falls back to
  // the default 1:NRR ladder (tpPoints = N × stopBricks × brickPoints).
  rrBuckets: text("rr_buckets"),
  // Level ladder for each scaling schedule — JSON array of
  //   { name, recommendedBalance, profitPerTrade, initialRisk,
  //     recovery1Risk, recovery2Risk }
  // ordered by recommendedBalance ascending. Enables auto-suggested trade
  // PnLs in the Add-trade modal. null = no schedule (manual PnL only).
  premiumScalingSchedule: text("premium_scaling_schedule"),
  speedScalingSchedule: text("speed_scaling_schedule"),
  // Unguessable random token for public read-only sharing. null = private.
  shareToken: text("share_token"),
  // Lifecycle status of the whole dataset, surfaced (color-coded) in the
  // dataset switcher. Defaults to "active".
  status: text("status", {
    enum: ["active", "paused", "discontinued"],
  })
    .default("active")
    .notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

export const backtestTrades = sqliteTable("backtest_trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  datasetId: integer("dataset_id")
    .notNull()
    .references(() => backtestDatasets.id, { onDelete: "cascade" }),
  // Stable ordinal so trades render in the order entered/imported, even if
  // many share the same date (intraday T1, T2, T3 sequence).
  sequenceIdx: integer("sequence_idx").notNull(),
  date: integer("date").notNull(), // ms — entry date at local midnight
  time: text("time").notNull().default(""), // display string, e.g. "9:00:00 AM"
  side: text("side", { enum: ["LONG", "SHORT"] }).notNull(),
  tradeNo: integer("trade_no").default(0).notNull(),
  validEntry: integer("valid_entry", { mode: "boolean" }).default(true).notNull(),
  outcome: text("outcome", { enum: ["Took Profit", "Took Loss", "Breakeven"] }), // null = pending
  mae: real("mae"), // points
  mfe: real("mfe"), // points
  // Realized points at exit — used by fluid TP/SL datasets.
  resultPoints: real("result_points"),
  recoveryStage: text("recovery_stage", { enum: ["none", "first", "second"] })
    .default("none")
    .notNull(),
  // When true, this trade is a placeholder for an upcoming recovery — the
  // user knows the next signal will be a recovery and reserves a row for it
  // before the trade actually fires. Combined with recoveryStage="first" or
  // "second" to indicate which one is pending.
  isPending: integer("is_pending", { mode: "boolean" }).default(false).notNull(),
  premiumPnl: real("premium_pnl"),
  premiumBalance: real("premium_balance"),
  premiumLabel: text("premium_label"),
  // When set, this trade is a manual balance reset for premium scaling —
  // typically used after the account blew, to declare a new starting point
  // mid-stream. Running-balance computation jumps to this value before
  // applying this trade's pnl.
  premiumResetBalance: real("premium_reset_balance"),
  speedPnl: real("speed_pnl"),
  speedBalance: real("speed_balance"),
  speedLabel: text("speed_label"),
  speedResetBalance: real("speed_reset_balance"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

// ---------------------------------------------------------------------------
// Investor ledger — track outside capital in a trading account and show each
// investor their pro-rata share of each month's result.
//
// The model is deliberately simple, matching how the source spreadsheet works:
// per month you record ONE net profit figure and ONE fee figure for the whole
// fund, plus each investor's contribution for that month. Everything else is
// derived pro-rata from contribution share.
// ---------------------------------------------------------------------------

export const investorFunds = sqliteTable("investor_funds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Free-form blurb shown to clients on the shared page (strategy, terms…).
  notes: text("notes"),
  // Display currency for the whole book. No FX conversion — the owner enters
  // amounts directly in this currency; the label just disambiguates CA$ vs $.
  currency: text("currency", { enum: ["CAD", "USD"] })
    .default("CAD")
    .notNull(),
  // Unguessable token for the public read-only client view. null = private.
  shareToken: text("share_token"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

export const investors = sqliteTable("investors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fundId: integer("fund_id")
    .notNull()
    .references(() => investorFunds.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Soft-hide an investor who has fully withdrawn without deleting history.
  active: integer("active", { mode: "boolean" }).default(true).notNull(),
  sortIdx: integer("sort_idx").default(0).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

// One row per fund per month. totalProfit is the single number the owner edits.
export const investorPeriods = sqliteTable("investor_periods", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fundId: integer("fund_id")
    .notNull()
    .references(() => investorFunds.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  month: integer("month").notNull(), // 1-12
  totalProfit: real("total_profit").default(0).notNull(),
  totalFees: real("total_fees").default(0).notNull(),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});

// An investor's capital in a given month. Contributions can change month to
// month as clients add or withdraw.
export const investorEntries = sqliteTable("investor_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  periodId: integer("period_id")
    .notNull()
    .references(() => investorPeriods.id, { onDelete: "cascade" }),
  investorId: integer("investor_id")
    .notNull()
    .references(() => investors.id, { onDelete: "cascade" }),
  contribution: real("contribution").default(0).notNull(),
  // Optional wire/withdrawal fee charged to this investor this month. Does not
  // affect the current month's pro-rata split; it's deducted from this
  // investor's opening capital when the next month carries forward.
  withdrawalFee: real("withdrawal_fee").default(0).notNull(),
});
