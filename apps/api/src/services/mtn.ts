import { config } from "../config.js";
import { audit, pool, withTransaction } from "../db.js";
import { assertTransition } from "../domain/states.js";
import { enqueueText } from "./outbox.js";
import { message, type Language } from "../i18n.js";

type MtnStatus = {
  status: "PENDING" | "SUCCESSFUL" | "FAILED";
  financialTransactionId?: string;
  reason?: string;
};

let cachedToken: { value: string; expiresAt: number } | undefined;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  const credentials = Buffer.from(`${config.MTN_API_USER}:${config.MTN_API_KEY}`).toString("base64");
  const response = await fetch(`${config.MTN_BASE_URL}/collection/token/`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Ocp-Apim-Subscription-Key": config.MTN_COLLECTION_SUBSCRIPTION_KEY ?? ""
    }
  });
  if (!response.ok) throw new Error(`MTN token request failed (${response.status}): ${await response.text()}`);
  const body = await response.json() as { access_token: string; expires_in: number };
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

export async function requestToPay(input: {
  referenceId: string;
  externalId: string;
  amountXaf: number;
  payerMsisdn: string;
}): Promise<void> {
  if (config.mtnMode === "simulator") return;
  const token = await getAccessToken();
  const response = await fetch(`${config.MTN_BASE_URL}/collection/v1_0/requesttopay`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Ocp-Apim-Subscription-Key": config.MTN_COLLECTION_SUBSCRIPTION_KEY ?? "",
      "X-Target-Environment": config.MTN_TARGET_ENVIRONMENT,
      "X-Reference-Id": input.referenceId,
      "X-Callback-Url": config.MTN_CALLBACK_URL,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      amount: String(input.amountXaf),
      currency: "XAF",
      externalId: input.externalId,
      payer: { partyIdType: "MSISDN", partyId: input.payerMsisdn },
      payerMessage: `FIYAH transfer ${input.externalId}`,
      payeeNote: `FIYAH transfer ${input.externalId}`
    })
  });
  if (response.status !== 202) {
    throw new Error(`MTN RequestToPay failed (${response.status}): ${await response.text()}`);
  }
}

export async function getRequestStatus(referenceId: string): Promise<MtnStatus> {
  if (config.mtnMode === "simulator") {
    const result = await pool.query(
      "SELECT COALESCE(mtn_status, 'PENDING') AS status, mtn_financial_transaction_id FROM transfers WHERE mtn_reference_id = $1",
      [referenceId]
    );
    if (!result.rows[0]) throw new Error("Unknown simulated MTN reference");
    return {
      status: result.rows[0].status,
      financialTransactionId: result.rows[0].mtn_financial_transaction_id ?? undefined
    };
  }
  const token = await getAccessToken();
  const response = await fetch(`${config.MTN_BASE_URL}/collection/v1_0/requesttopay/${referenceId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Ocp-Apim-Subscription-Key": config.MTN_COLLECTION_SUBSCRIPTION_KEY ?? "",
      "X-Target-Environment": config.MTN_TARGET_ENVIRONMENT
    }
  });
  if (!response.ok) throw new Error(`MTN status request failed (${response.status}): ${await response.text()}`);
  const body = await response.json() as {
    status: MtnStatus["status"];
    financialTransactionId?: string;
    reason?: { message?: string };
  };
  return {
    status: body.status,
    financialTransactionId: body.financialTransactionId,
    reason: body.reason?.message
  };
}

export async function reconcileMtnReference(referenceId: string): Promise<void> {
  const authoritative = await getRequestStatus(referenceId);
  await withTransaction(async (client) => {
    const result = await client.query(
      `SELECT t.*, u.whatsapp_msisdn, COALESCE(u.language, 'en') AS language
       FROM transfers t JOIN users u ON u.id = t.user_id
       WHERE t.mtn_reference_id = $1 FOR UPDATE`,
      [referenceId]
    );
    const transfer = result.rows[0];
    if (!transfer || transfer.status !== "PAYMENT_PENDING") return;

    if (authoritative.status === "SUCCESSFUL") {
      assertTransition("PAYMENT_PENDING", "PAID");
      const deadline = new Date(Date.now() + config.FIYAH_PAYOUT_SLA_MINUTES * 60_000);
      await client.query(
        `UPDATE transfers SET
           status = 'PAID', mtn_status = 'SUCCESSFUL', mtn_financial_transaction_id = $2,
           paid_at = now(), payout_due_at = $3, updated_at = now(), version = version + 1
         WHERE id = $1`,
        [transfer.id, authoritative.financialTransactionId ?? null, deadline]
      );
      await client.query(
        "UPDATE users SET conversation_state = 'READY', conversation_context = '{}'::jsonb, updated_at = now() WHERE id = $1",
        [transfer.user_id]
      );
      await enqueueText(client, transfer.user_id, transfer.whatsapp_msisdn, message(transfer.language as Language, "paid", {
        reference: transfer.reference,
        deadline: deadline.toLocaleTimeString(transfer.language === "fr" ? "fr-FR" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Douala" })
      }));
      await audit(client, {
        actorType: "PROVIDER",
        actorId: "MTN",
        action: "PAYMENT_CONFIRMED",
        entityType: "TRANSFER",
        entityId: transfer.id,
        metadata: { referenceId, financialTransactionId: authoritative.financialTransactionId }
      });
    } else if (authoritative.status === "FAILED") {
      assertTransition("PAYMENT_PENDING", "PAYMENT_FAILED");
      await client.query(
        `UPDATE transfers SET status = 'PAYMENT_FAILED', mtn_status = 'FAILED', failure_reason = $2,
         updated_at = now(), version = version + 1 WHERE id = $1`,
        [transfer.id, authoritative.reason ?? "MTN payment failed"]
      );
      await client.query(
        "UPDATE users SET conversation_state = 'READY', conversation_context = '{}'::jsonb, updated_at = now() WHERE id = $1",
        [transfer.user_id]
      );
      await enqueueText(client, transfer.user_id, transfer.whatsapp_msisdn, message(transfer.language as Language, "paymentFailed"));
    }
  });
}

export async function pollPendingMtnPayments(): Promise<void> {
  const result = await pool.query(
    `SELECT mtn_reference_id FROM transfers
     WHERE status = 'PAYMENT_PENDING' AND mtn_reference_id IS NOT NULL
     ORDER BY payment_requested_at LIMIT 50`
  );
  for (const row of result.rows) {
    try {
      await reconcileMtnReference(row.mtn_reference_id);
    } catch (error) {
      console.error("MTN reconciliation failed", row.mtn_reference_id, error);
    }
  }
}
