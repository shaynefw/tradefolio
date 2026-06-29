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
  outcome: text("outcome", { enum: ["Took Profit", "Took Loss"] }), // null = pending
  mae: real("mae"), // points
  mfe: real("mfe"), // points
  recoveryStage: text("recovery_stage", { enum: ["none", "first", "second"] })
    .default("none")
    .notNull(),
  premiumPnl: real("premium_pnl"),
  premiumBalance: real("premium_balance"),
  premiumLabel: text("premium_label"),
  speedPnl: real("speed_pnl"),
  speedBalance: real("speed_balance"),
  speedLabel: text("speed_label"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(unixepoch() * 1000)`)
    .notNull(),
});
