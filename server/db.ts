import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../drizzle/schema.js";
import path from "path";
import fs from "fs";

function makeClient() {
  // Production: Turso cloud database
  if (process.env.DATABASE_URL) {
    return createClient({
      url: process.env.DATABASE_URL,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
  }

  // Development: local SQLite file
  const dbPath = path.resolve(process.env.DATABASE_PATH ?? "./data/tradefolio.db");
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  return createClient({ url: `file:${dbPath}` });
}

const client = makeClient();
export const db = drizzle(client, { schema });

export async function initDb() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
    `CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      broker TEXT,
      account_number TEXT,
      description TEXT,
      color TEXT DEFAULT '#6366f1',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
    `CREATE TABLE IF NOT EXISTS strategies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT DEFAULT '#6366f1',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
    `CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      strategy_id INTEGER REFERENCES strategies(id) ON DELETE SET NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('long', 'short')),
      quantity REAL,
      entry_price REAL,
      exit_price REAL,
      entry_date INTEGER,
      exit_date INTEGER,
      pnl REAL,
      fees REAL DEFAULT 0,
      net_pnl REAL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
    `CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#6366f1',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
    `CREATE TABLE IF NOT EXISTS trade_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      UNIQUE(trade_id, tag_id)
    )`,
    `CREATE TABLE IF NOT EXISTS backtest_datasets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      brick_points INTEGER NOT NULL DEFAULT 20,
      stop_bricks INTEGER NOT NULL DEFAULT 8,
      take_profit_bricks INTEGER NOT NULL DEFAULT 2,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
    `CREATE TABLE IF NOT EXISTS backtest_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id INTEGER NOT NULL REFERENCES backtest_datasets(id) ON DELETE CASCADE,
      sequence_idx INTEGER NOT NULL,
      date INTEGER NOT NULL,
      time TEXT NOT NULL DEFAULT '',
      side TEXT NOT NULL CHECK(side IN ('LONG', 'SHORT')),
      trade_no INTEGER NOT NULL DEFAULT 0,
      valid_entry INTEGER NOT NULL DEFAULT 1,
      outcome TEXT CHECK(outcome IN ('Took Profit', 'Took Loss') OR outcome IS NULL),
      mae REAL,
      mfe REAL,
      recovery_stage TEXT NOT NULL DEFAULT 'none' CHECK(recovery_stage IN ('none', 'first', 'second')),
      premium_pnl REAL,
      premium_balance REAL,
      premium_label TEXT,
      speed_pnl REAL,
      speed_balance REAL,
      speed_label TEXT,
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_backtest_trades_dataset ON backtest_trades(dataset_id, sequence_idx)`,
  ];

  for (const sql of statements) {
    await client.execute(sql);
  }

  // Idempotent ALTER TABLE additions for columns introduced after the
  // original CREATE TABLE statements. SQLite ALTER TABLE doesn't support
  // IF NOT EXISTS until 3.35, so check via PRAGMA table_info first.
  await addColumnIfMissing(
    "backtest_datasets",
    "premium_start_balance",
    "REAL",
  );
  await addColumnIfMissing("backtest_datasets", "speed_start_balance", "REAL");
  await addColumnIfMissing(
    "backtest_trades",
    "premium_reset_balance",
    "REAL",
  );
  await addColumnIfMissing("backtest_trades", "speed_reset_balance", "REAL");
  await addColumnIfMissing(
    "backtest_trades",
    "is_pending",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await addColumnIfMissing("backtest_datasets", "notes", "TEXT");
  await addColumnIfMissing("backtest_datasets", "rr_buckets", "TEXT");
  await addColumnIfMissing(
    "backtest_datasets",
    "premium_scaling_schedule",
    "TEXT",
  );
  await addColumnIfMissing(
    "backtest_datasets",
    "speed_scaling_schedule",
    "TEXT",
  );
}

async function addColumnIfMissing(
  table: string,
  column: string,
  definition: string,
) {
  const result = await client.execute(`PRAGMA table_info(${table})`);
  const exists = result.rows.some((row) => row.name === column);
  if (!exists) {
    await client.execute(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
    );
  }
}

export { schema };
