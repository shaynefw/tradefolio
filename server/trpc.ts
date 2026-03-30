import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Request, Response } from "express";
import { getSessionFromRequest } from "./auth.js";
import { db, schema } from "./db.js";
import { eq } from "drizzle-orm";

export interface Context {
  req: Request;
  res: Response;
  user: { id: number; email: string; role: string } | null;
}

export async function createContext({ req, res }: { req: Request; res: Response }): Promise<Context> {
  const session = await getSessionFromRequest(req);
  let user: { id: number; email: string; role: string } | null = null;

  if (session) {
    const [dbUser] = await db
      .select({ id: schema.users.id, email: schema.users.email, role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, session.userId))
      .limit(1);
    if (dbUser) user = dbUser;
  }

  return { req, res, user };
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
  }
  return next({ ctx });
});
