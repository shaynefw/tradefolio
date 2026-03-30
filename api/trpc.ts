import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import type { VercelRequest, VercelResponse } from "@vercel/node";

import { appRouter } from "../server/routers/index.js";
import { createContext } from "../server/trpc.js";
import { initDb } from "../server/db.js";

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(
  "/",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

// Initialize DB once per cold start
const ready = initDb().catch(console.error);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ready;
  return new Promise<void>((resolve) => {
    app(req as any, res as any, () => resolve());
    res.on("finish", resolve);
  });
}
