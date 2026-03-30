export type UserRole = "user" | "admin";
export type TradeSide = "long" | "short";
export type TradeStatus = "open" | "closed";

export interface User {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
  createdAt: Date;
}

export interface Account {
  id: number;
  userId: number;
  name: string;
  broker: string | null;
  accountNumber: string | null;
  description: string | null;
  color: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Strategy {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  color: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Tag {
  id: number;
  userId: number;
  name: string;
  color: string | null;
  createdAt: Date;
}

export interface Trade {
  id: number;
  userId: number;
  accountId: number | null;
  strategyId: number | null;
  symbol: string;
  side: TradeSide;
  quantity: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  entryDate: number | null;
  exitDate: number | null;
  pnl: number | null;
  fees: number | null;
  netPnl: number | null;
  status: TradeStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  tags?: Tag[];
  account?: Account | null;
  strategy?: Strategy | null;
}

export interface TradeWithRelations extends Trade {
  tags: Tag[];
  account: Account | null;
  strategy: Strategy | null;
}

export const LIMITS = {
  ACCOUNTS_PER_USER: 40,
  TRADES_PER_ACCOUNT: 10000,
  TAGS_PER_USER: 200,
  STRATEGIES_PER_USER: 50,
  CSV_ROWS_PER_IMPORT: 500,
  NOTE_MAX_CHARS: 1000,
  APPROACH_LIMIT_PCT: 0.8,
} as const;

export const FUTURES_MULTIPLIERS: Record<string, number> = {
  ES: 50,
  MES: 5,
  NQ: 20,
  MNQ: 2,
  RTY: 50,
  M2K: 5,
  YM: 5,
  MYM: 0.5,
  CL: 1000,
  MCL: 100,
  GC: 100,
  MGC: 10,
  SI: 5000,
  HG: 25000,
  ZB: 1000,
  ZN: 1000,
  ZF: 1000,
  ZT: 2000,
  "6E": 125000,
  "6J": 12500000,
  "6B": 62500,
  "6A": 100000,
  "6C": 100000,
};
