import { router } from "../trpc.js";
import { authRouter } from "./auth.js";
import { accountRouter } from "./account.js";
import { tradeRouter } from "./trade.js";
import { tagRouter } from "./tag.js";
import { strategyRouter } from "./strategy.js";
import { backupRouter } from "./backup.js";

export const appRouter = router({
  auth: authRouter,
  account: accountRouter,
  trade: tradeRouter,
  tag: tagRouter,
  strategy: strategyRouter,
  backup: backupRouter,
});

export type AppRouter = typeof appRouter;
