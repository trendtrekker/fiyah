import type { DbClient } from "../db.js";
import { config } from "../config.js";
import { pool } from "../db.js";

export async function enqueueText(client: DbClient, userId: string, msisdn: string, text: string): Promise<void> {
  await client.query(
    `INSERT INTO message_outbox(user_id, recipient_msisdn, message_type, payload)
     VALUES ($1, $2, 'text', $3)`,
    [userId, msisdn, JSON.stringify({ text })]
  );
}

async function sendCloudText(msisdn: string, text: string): Promise<string> {
  const response = await fetch(
    `https://graph.facebook.com/${config.WHATSAPP_API_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: msisdn,
        type: "text",
        text: { preview_url: false, body: text }
      })
    }
  );
  if (!response.ok) throw new Error(`WhatsApp API ${response.status}: ${await response.text()}`);
  const body = await response.json() as { messages?: Array<{ id: string }> };
  return body.messages?.[0]?.id ?? "unknown";
}

export async function flushOutbox(limit = 20): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id, recipient_msisdn, payload
       FROM message_outbox
       WHERE status = 'PENDING'
       ORDER BY created_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit]
    );

    for (const row of result.rows) {
      try {
        const providerId = config.whatsappMode === "simulator"
          ? `sim-${row.id}`
          : await sendCloudText(row.recipient_msisdn, row.payload.text);
        await client.query(
          `UPDATE message_outbox
           SET status = 'SENT', provider_message_id = $2, sent_at = now(), attempts = attempts + 1
           WHERE id = $1`,
          [row.id, providerId]
        );
      } catch (error) {
        await client.query(
          `UPDATE message_outbox
           SET attempts = attempts + 1,
               status = CASE WHEN attempts >= 4 THEN 'FAILED' ELSE 'PENDING' END,
               last_error = $2
           WHERE id = $1`,
          [row.id, error instanceof Error ? error.message : String(error)]
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
