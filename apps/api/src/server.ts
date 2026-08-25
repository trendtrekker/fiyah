import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { config } from "./config.js";
import { pool } from "./db.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerInternalRoutes } from "./routes/internal.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { pollPendingMtnPayments } from "./services/mtn.js";
import { flushOutbox } from "./services/outbox.js";

declare module "fastify" {
  interface FastifyInstance {
    db: typeof pool;
  }
}

const app = Fastify({
  logger: {
    level: config.NODE_ENV === "development" ? "debug" : "info",
    redact: ["req.headers.authorization", "req.headers.cookie", "body.password", "body.idNumber"]
  }
});

app.decorate("db", pool);
app.removeContentTypeParser("application/json");
app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
  try {
    const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
    request.rawBody = rawBody;
    done(null, JSON.parse(rawBody.toString("utf8")));
  } catch (error) {
    done(error as Error, undefined);
  }
});

await app.register(cookie);
await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });

// Vercel functions do not keep process timers alive. Flush queued WhatsApp
// replies after state-changing requests so messages are delivered before the
// invocation ends. The database outbox still provides retries and idempotency.
app.addHook("onSend", async (request, _reply, payload) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    try {
      await flushOutbox();
    } catch (error) {
      app.log.error(error, "Unable to flush WhatsApp outbox");
    }
  }
  return payload;
});

app.get("/health", async () => {
  await pool.query("SELECT 1");
  return {
    status: "ok",
    service: "fiyah-api",
    whatsappMode: config.whatsappMode,
    mtnMode: config.mtnMode,
    timestamp: new Date().toISOString()
  };
});

await registerPublicRoutes(app);
await registerWebhookRoutes(app);
await registerAdminRoutes(app);
await registerInternalRoutes(app);

app.setErrorHandler((error: unknown, _request, reply) => {
  if (error instanceof ZodError) {
    return reply.code(400).send({ error: "Validation failed", issues: error.issues });
  }
  app.log.error(error);
  const typedError = error instanceof Error ? error : new Error(String(error));
  const status = "statusCode" in typedError && typeof typedError.statusCode === "number" ? typedError.statusCode : 400;
  return reply.code(status >= 500 ? 500 : status).send({
    error: config.NODE_ENV === "production" && status >= 500 ? "Internal server error" : typedError.message
  });
});

let outboxTimer: NodeJS.Timeout | undefined;
let mtnTimer: NodeJS.Timeout | undefined;
if (!process.env.VERCEL) {
  outboxTimer = setInterval(() => void flushOutbox().catch((error) => app.log.error(error)), 2_000);
  mtnTimer = setInterval(() => void pollPendingMtnPayments().catch((error) => app.log.error(error)), 10_000);
  outboxTimer.unref();
  mtnTimer.unref();
}

const close = async () => {
  if (outboxTimer) clearInterval(outboxTimer);
  if (mtnTimer) clearInterval(mtnTimer);
  await app.close();
  await pool.end();
};
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());

await app.listen({ port: config.API_PORT, host: "0.0.0.0" });
