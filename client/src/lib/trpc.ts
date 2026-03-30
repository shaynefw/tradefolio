import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../../server/routers/index.js";

export const trpc = createTRPCReact<AppRouter>();

// In production (Vercel), tRPC lives at /api/trpc
// In development, Vite proxies /trpc → localhost:3001/trpc
export const trpcUrl = import.meta.env.PROD ? "/api/trpc" : "/trpc";
