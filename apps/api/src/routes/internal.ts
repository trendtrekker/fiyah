import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { pollPendingMtnPayments } from "../services/mtn.js";
import { flushOutbox } from "../services/outbox.js";

function hasValidCronSecret(request: FastifyRequest): boolean {
  if (!config.CRON_SECRET) return false;
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(config.CRON_SECRET);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function registerInternalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/internal/jobs/reconcile", async (request, reply) => {
    if (!hasValidCronSecret(request)) return reply.code(404).send();
    await pollPendingMtnPayments();
    await flushOutbox(50);
    return { ok: true, completedAt: new Date().toISOString() };
  });
}
