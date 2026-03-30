import "dotenv/config";

export const env = {
  JWT_SECRET: process.env.JWT_SECRET ?? "dev-secret-please-change",
  DATABASE_PATH: process.env.DATABASE_PATH ?? "./data/tradefolio.db",
  PORT: parseInt(process.env.PORT ?? "3001", 10),
  NODE_ENV: process.env.NODE_ENV ?? "development",
  isDev: (process.env.NODE_ENV ?? "development") === "development",
};
