import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { handleIncomingMessage } from "../services/conversation.js";
import { reconcileMtnReference } from "../services/mtn.js";

function verifyMetaSignature(request: FastifyRequest): boolean {
  if (!config.WHATSAPP_APP_SECRET) return config.NODE_ENV !== "production";
  const provided = request.headers["x-hub-signature-256"];
  if (typeof provided !== "string" || !request.rawBody) return false;
  const expected = `sha256=${createHmac("sha256", config.WHATSAPP_APP_SECRET).update(request.rawBody).digest("hex")}`;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type WhatsAppMessage = {
  id: string;
  from: string;
  type: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
};

type WhatsAppPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WhatsAppMessage[];
      };
    }>;
  }>;
};

function extractText(message: WhatsAppMessage): string | undefined {
  return message.text?.body
    ?? message.button?.text
    ?? message.interactive?.button_reply?.title
    ?? message.interactive?.list_reply?.title;
}

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.get("/webhooks/whatsapp", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    if (
      query["hub.mode"] === "subscribe" &&
      config.WHATSAPP_VERIFY_TOKEN &&
      query["hub.verify_token"] === config.WHATSAPP_VERIFY_TOKEN
    ) {
      return reply.type("text/plain").send(query["hub.challenge"] ?? "");
    }
    return reply.code(403).send({ error: "Webhook verification failed" });
  });

  app.post("/webhooks/whatsapp", async (request, reply) => {
    if (!verifyMetaSignature(request)) return reply.code(401).send({ error: "Invalid webhook signature" });
    const payload = request.body as WhatsAppPayload;
    const messages = payload.entry?.flatMap((entry) => entry.changes ?? [])
      .flatMap((change) => change.value?.messages ?? []) ?? [];
    for (const inbound of messages) {
      const text = extractText(inbound);
      if (!text) continue;
      await handleIncomingMessage({ providerMessageId: inbound.id, msisdn: inbound.from, text });
    }
    return reply.code(200).send({ received: true });
  });

  app.post("/webhooks/mtn", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const referenceId = typeof body.referenceId === "string"
      ? body.referenceId
      : typeof request.headers["x-reference-id"] === "string" ? request.headers["x-reference-id"] : undefined;
    if (!referenceId) return reply.code(202).send({ received: true });
    // MTN callbacks are a reconciliation trigger only; status is independently fetched from MTN.
    await reconcileMtnReference(referenceId);
    return reply.code(200).send({ received: true });
  });

  app.post("/sandbox/messages", async (request, reply) => {
    if (config.NODE_ENV === "production") return reply.code(404).send();
    const body = z.object({ msisdn: z.string(), text: z.string().min(1), messageId: z.string().optional() }).parse(request.body);
    await handleIncomingMessage({
      providerMessageId: body.messageId ?? `sim-${crypto.randomUUID()}`,
      msisdn: body.msisdn,
      text: body.text
    });
    return reply.code(202).send({ accepted: true });
  });

  app.post("/sandbox/mtn/:reference/status", async (request, reply) => {
    if (config.NODE_ENV === "production") return reply.code(404).send();
    const params = z.object({ reference: z.string() }).parse(request.params);
    const body = z.object({ status: z.enum(["SUCCESSFUL", "FAILED"]), reason: z.string().optional() }).parse(request.body);
    const result = await app.db.query(
      `UPDATE transfers SET mtn_status = $2,
       mtn_financial_transaction_id = CASE WHEN $2 = 'SUCCESSFUL' THEN COALESCE(mtn_financial_transaction_id, $3) ELSE mtn_financial_transaction_id END,
       failure_reason = CASE WHEN $2 = 'FAILED' THEN $4 ELSE failure_reason END,
       updated_at = now()
       WHERE reference = $1 AND status = 'PAYMENT_PENDING' RETURNING mtn_reference_id`,
      [params.reference, body.status, `SIM-${Date.now()}`, body.reason ?? "Simulated failure"]
    );
    if (!result.rows[0]) return reply.code(404).send({ error: "Pending transfer not found" });
    await reconcileMtnReference(result.rows[0].mtn_reference_id);
    return { ok: true };
  });

  app.get("/sandbox/outbox/:msisdn", async (request, reply) => {
    if (config.NODE_ENV === "production") return reply.code(404).send();
    const params = z.object({ msisdn: z.string() }).parse(request.params);
    const result = await app.db.query(
      `SELECT id, payload, status, created_at FROM message_outbox
       WHERE recipient_msisdn = $1 ORDER BY created_at DESC LIMIT 50`,
      [params.msisdn.replace(/\D/g, "")]
    );
    return { items: result.rows };
  });
}
