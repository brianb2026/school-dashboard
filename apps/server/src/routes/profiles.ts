import type { FastifyInstance } from "fastify";
import type { ProfileInfo } from "@sd/core";
import type { AppContext } from "../app.js";
import { getSetting } from "../db/client.js";

/**
 * Profiles on the sign-in screen: list them, add one, switch to one.
 * Switching closes this profile (any sign-in window too) and opens the other
 * a moment after this answer goes out; the page waits, then reloads.
 */
export function profileRoutes(app: FastifyInstance, ctx: AppContext): void {
  const host = ctx.profiles;

  app.get("/api/profiles", async (): Promise<{ active: string; profiles: ProfileInfo[] }> => {
    if (!host) return { active: "main", profiles: [{ id: "main", name: getSetting(ctx.db, "STUDENT_NAME"), active: true }] };
    return { active: host.active(), profiles: host.list() };
  });

  app.post("/api/profiles", async (_req, reply) => {
    if (!host) return reply.code(400).send({ error: "Profiles aren't available here." });
    const id = host.create();
    await ctx.linker.cancel();
    host.switchTo(id);
    return { id };
  });

  app.post<{ Params: { id: string } }>("/api/profiles/:id/switch", async (req, reply) => {
    if (!host) return reply.code(400).send({ error: "Profiles aren't available here." });
    const id = req.params.id;
    if (!host.list().some((p) => p.id === id)) return reply.code(404).send({ error: "No such profile." });
    if (id === host.active()) return { id };
    await ctx.linker.cancel();
    host.switchTo(id);
    return { id };
  });
}
