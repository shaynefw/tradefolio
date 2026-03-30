import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers/index.js";
import { createContext } from "./trpc.js";
import { initDb } from "./db.js";
import { env } from "./env.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// tRPC middleware
app.use(
  "/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

// Serve static files in production
if (!env.isDev) {
  const distPath = path.join(__dirname, "public");
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
}

initDb().then(() => {
  app.listen(env.PORT, () => {
    console.log(`🚀 Tradefolio server running on http://localhost:${env.PORT}`);
    if (env.isDev) {
      console.log(`   Client dev server: http://localhost:5173`);
      console.log(`   tRPC endpoint: http://localhost:${env.PORT}/trpc`);
    }
  });
}).catch((err) => {
  console.error("Failed to initialize database:", err);
  process.exit(1);
});
