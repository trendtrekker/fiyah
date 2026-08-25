import { config } from "../config.js";
import { encryptField } from "../crypto.js";
import { audit, pool, withTransaction, type DbClient } from "../db.js";
import { newExternalId, newHumanReference, normalizeCameroonMsisdn } from "../domain/identifiers.js";
import { assertTransferLimits, calculateQuote } from "../domain/money.js";
import { assertTransition, type ConversationState } from "../domain/states.js";
import { createKycToken } from "../auth.js";
import { message, type Language } from "../i18n.js";
import { requestToPay } from "./mtn.js";
import { enqueueText } from "./outbox.js";

type PaymentAction = {
  transferId: string;
  userId: string;
  language: Language;
  msisdn: string;
  referenceId: string;
  externalId: string;
  amountXaf: number;
};

const normalizeCommand = (value: string) => value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const yesCommands = new Set(["YES", "Y", "OUI", "PAY", "PAYER"]);
const noCommands = new Set(["NO", "N", "NON", "CANCEL", "ANNULER"]);
const sendCommands = new Set(["SEND", "ENVOYER", "1"]);
const statusCommands = new Set(["STATUS", "STATUT", "2"]);
const helpCommands = new Set(["HELP", "AIDE", "3"]);

function formatInteger(value: number | string, language: Language): string {
  return Number(value).toLocaleString(language === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: 0 });
}

async function updateUserState(
  client: DbClient,
  userId: string,
  state: ConversationState,
  context: Record<string, unknown> = {}
): Promise<void> {
  await client.query(
    "UPDATE users SET conversation_state = $2, conversation_context = $3, updated_at = now() WHERE id = $1",
    [userId, state, JSON.stringify(context)]
  );
}

async function statusText(client: DbClient, userId: string, language: Language): Promise<string> {
  const result = await client.query(
    `SELECT reference, status, principal_xaf, recipient_ngn, payout_due_at
     FROM transfers WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  const transfer = result.rows[0];
  if (!transfer) return language === "fr" ? "Vous n'avez aucun transfert FIYAH." : "You do not have any FIYAH transfers yet.";
  return language === "fr"
    ? `Transfert ${transfer.reference}\nStatut : ${transfer.status}\nMontant : ${formatInteger(transfer.principal_xaf ?? 0, language)} XAF`
    : `Transfer ${transfer.reference}\nStatus: ${transfer.status}\nAmount: ${formatInteger(transfer.principal_xaf ?? 0, language)} XAF`;
}

async function processMessage(
  client: DbClient,
  input: { providerMessageId: string; msisdn: string; text: string }
): Promise<PaymentAction | undefined> {
  const inserted = await client.query(
    `INSERT INTO webhook_events(provider, provider_event_id, payload, processed_at)
     VALUES ('WHATSAPP', $1, $2, now()) ON CONFLICT DO NOTHING RETURNING id`,
    [input.providerMessageId, JSON.stringify(input)]
  );
  if (!inserted.rowCount) return;

  const normalizedMsisdn = normalizeCameroonMsisdn(input.msisdn);
  await client.query(
    `INSERT INTO users(whatsapp_msisdn, momo_msisdn)
     VALUES ($1, $1) ON CONFLICT (whatsapp_msisdn) DO NOTHING`,
    [normalizedMsisdn]
  );
  const userResult = await client.query("SELECT * FROM users WHERE whatsapp_msisdn = $1 FOR UPDATE", [normalizedMsisdn]);
  const user = userResult.rows[0];
  const command = normalizeCommand(input.text);
  let language: Language = user.language === "fr" ? "fr" : "en";
  const context = (user.conversation_context ?? {}) as Record<string, unknown>;

  if (command === "EN" || command === "FR") {
    language = command === "FR" ? "fr" : "en";
    await client.query("UPDATE users SET language = $2, updated_at = now() WHERE id = $1", [user.id, language]);
    if (user.kyc_status === "APPROVED") {
      await updateUserState(client, user.id, "READY");
      await enqueueText(client, user.id, normalizedMsisdn, message(language, "menu"));
    } else if (user.kyc_status === "PENDING") {
      await updateUserState(client, user.id, "KYC_PENDING");
      await enqueueText(client, user.id, normalizedMsisdn, message(language, "kycPending"));
    } else {
      const token = await createKycToken(user.id);
      await updateUserState(client, user.id, "KYC_REQUIRED");
      await enqueueText(client, user.id, normalizedMsisdn, message(language, "kycRequired", {
        url: `${config.PUBLIC_APP_URL}/kyc#token=${encodeURIComponent(token)}`
      }));
    }
    return;
  }

  if (!user.language) {
    await enqueueText(client, user.id, normalizedMsisdn, message("en", "welcome"));
    return;
  }

  if (command === "MENU") {
    if (user.kyc_status !== "APPROVED") {
      const key = user.kyc_status === "PENDING" ? "kycPending" : "kycRequired";
      const token = key === "kycRequired" ? await createKycToken(user.id) : undefined;
      await enqueueText(client, user.id, normalizedMsisdn, message(language, key, token ? {
        url: `${config.PUBLIC_APP_URL}/kyc#token=${encodeURIComponent(token)}`
      } : {}));
    } else {
      await updateUserState(client, user.id, "READY");
      await enqueueText(client, user.id, normalizedMsisdn, message(language, "menu"));
    }
    return;
  }

  if (user.kyc_status !== "APPROVED") {
    if (user.kyc_status === "PENDING") {
      await enqueueText(client, user.id, normalizedMsisdn, message(language, "kycPending"));
    } else {
      const token = await createKycToken(user.id);
      await enqueueText(client, user.id, normalizedMsisdn, message(language, "kycRequired", {
        url: `${config.PUBLIC_APP_URL}/kyc#token=${encodeURIComponent(token)}`
      }));
    }
    return;
  }

  if (statusCommands.has(command)) {
    await enqueueText(client, user.id, normalizedMsisdn, await statusText(client, user.id, language));
    return;
  }
  if (helpCommands.has(command)) {
    await enqueueText(client, user.id, normalizedMsisdn, message(language, "help"));
    await audit(client, { actorType: "USER", actorId: user.id, action: "SUPPORT_REQUESTED", entityType: "USER", entityId: user.id });
    return;
  }

  switch (user.conversation_state as ConversationState) {
    case "READY":
      if (sendCommands.has(command)) {
        await updateUserState(client, user.id, "AWAITING_BANK");
        await enqueueText(client, user.id, normalizedMsisdn, message(language, "askBank"));
      } else {
        await enqueueText(client, user.id, normalizedMsisdn, message(language, "menu"));
      }
      return;

    case "AWAITING_BANK": {
      const bankName = input.text.trim().slice(0, 100);
      if (bankName.length < 2) {
        await enqueueText(client, user.id, normalizedMsisdn, message(language, "askBank"));
        return;
      }
      await updateUserState(client, user.id, "AWAITING_ACCOUNT_NUMBER", { bankName });
      await enqueueText(client, user.id, normalizedMsisdn, message(language, "askAccount"));
      return;
    }

    case "AWAITING_ACCOUNT_NUMBER": {
      const accountNumber = input.text.replace(/\D/g, "");
      if (!/^\d{10}$/.test(accountNumber)) {
        await enqueueText(client, user.id, normalizedMsisdn, message(language, "askAccount"));
        return;
      }
      const beneficiaryResult = await client.query(
        `INSERT INTO beneficiaries(user_id, bank_name, encrypted_account_number, account_number_last4)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [user.id, context.bankName, encryptField(accountNumber), accountNumber.slice(-4)]
      );
      await updateUserState(client, user.id, "AWAITING_RELATIONSHIP", { beneficiaryId: beneficiaryResult.rows[0].id });
      await enqueueText(client, user.id, normalizedMsisdn, message(language, "askRelationship"));
      return;
    }

    case "AWAITING_RELATIONSHIP":
      await updateUserState(client, user.id, "AWAITING_PURPOSE", {
        beneficiaryId: context.beneficiaryId,
        relationship: input.text.trim().slice(0, 100)
      });
      await enqueueText(client, user.id, normalizedMsisdn, message(language, "askPurpose"));
      return;

    case "AWAITING_PURPOSE": {
      const transferResult = await client.query(
        `INSERT INTO transfers(reference, user_id, beneficiary_id, status, purpose, relationship)
         VALUES ($1, $2, $3, 'ACCOUNT_VERIFICATION_PENDING', $4, $5) RETURNING id`,
        [newHumanReference(), user.id, context.beneficiaryId, input.text.trim().slice(0, 200), context.relationship]
      );
      await updateUserState(client, user.id, "AWAITING_BENEFICIARY_VERIFICATION", { transferId: transferResult.rows[0].id });
      await enqueueText(client, user.id, normalizedMsisdn, message(language, "accountPending"));
      return;
    }

    case "AWAITING_BENEFICIARY_CONFIRMATION": {
      const transferId = String(context.transferId ?? "");
      if (noCommands.has(command)) {
        await client.query("UPDATE transfers SET status = 'CANCELLED', updated_at = now() WHERE id = $1 AND status = 'AWAITING_CONFIRMATION'", [transferId]);
        await updateUserState(client, user.id, "READY");
        await enqueueText(client, user.id, normalizedMsisdn, message(language, "cancelled"));
      } else if (yesCommands.has(command)) {
        await updateUserState(client, user.id, "AWAITING_AMOUNT", { transferId });
        await enqueueText(client, user.id, normalizedMsisdn, message(language, "askAmount", {
          minimum: formatInteger(config.FIYAH_MIN_TRANSFER_XAF, language),
          maximum: formatInteger(config.FIYAH_MAX_TRANSFER_XAF, language)
        }));
      } else {
        await enqueueText(client, user.id, normalizedMsisdn, message(language, "unsupported"));
      }
      return;
    }

    case "AWAITING_AMOUNT": {
      const principal = Number(input.text.replace(/[^\d]/g, ""));
      const transferId = String(context.transferId ?? "");
      const countResult = await client.query(
        `SELECT count(*)::int AS count FROM transfers
         WHERE user_id = $1 AND id <> $2
           AND created_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Douala') AT TIME ZONE 'Africa/Douala'
           AND status NOT IN ('PAYMENT_FAILED', 'CANCELLED')`,
        [user.id, transferId]
      );
      try {
        assertTransferLimits(principal, countResult.rows[0].count, {
          minimumXaf: config.FIYAH_MIN_TRANSFER_XAF,
          maximumXaf: config.FIYAH_MAX_TRANSFER_XAF,
          dailyCount: config.FIYAH_DAILY_TRANSFER_LIMIT
        });
      } catch (error) {
        await enqueueText(client, user.id, normalizedMsisdn, error instanceof Error ? error.message : message(language, "unsupported"));
        return;
      }
      const rateResult = await client.query("SELECT * FROM exchange_rates WHERE status = 'APPROVED' LIMIT 1");
      const rate = rateResult.rows[0];
      if (!rate) {
        await enqueueText(client, user.id, normalizedMsisdn, message(language, "noRate"));
        return;
      }
      const transferResult = await client.query(
        `SELECT t.id, b.account_name FROM transfers t JOIN beneficiaries b ON b.id = t.beneficiary_id
         WHERE t.id = $1 AND t.user_id = $2 AND t.status = 'AWAITING_CONFIRMATION' FOR UPDATE`,
        [transferId, user.id]
      );
      const transfer = transferResult.rows[0];
      if (!transfer) throw new Error("Transfer is no longer awaiting an amount");
      const amounts = calculateQuote(principal, Number(rate.ngn_per_xaf), config.FIYAH_SERVICE_FEE_BPS);
      const expiresAt = new Date(Date.now() + config.FIYAH_QUOTE_TTL_MINUTES * 60_000);
      const quoteResult = await client.query(
        `INSERT INTO quotes(user_id, beneficiary_id, exchange_rate_id, rate_ngn_per_xaf,
          principal_xaf, fee_bps, fee_xaf, total_charge_xaf, recipient_ngn, expires_at)
         SELECT $1, beneficiary_id, $2, $3, $4, $5, $6, $7, $8, $9
         FROM transfers WHERE id = $10 RETURNING id`,
        [user.id, rate.id, rate.ngn_per_xaf, amounts.principalXaf, config.FIYAH_SERVICE_FEE_BPS,
          amounts.feeXaf, amounts.totalChargeXaf, amounts.recipientNgn, expiresAt, transferId]
      );
      await client.query(
        `UPDATE transfers SET quote_id = $2, principal_xaf = $3, fee_xaf = $4, total_charge_xaf = $5,
         recipient_ngn = $6, rate_ngn_per_xaf = $7, updated_at = now() WHERE id = $1`,
        [transferId, quoteResult.rows[0].id, amounts.principalXaf, amounts.feeXaf,
          amounts.totalChargeXaf, amounts.recipientNgn, rate.ngn_per_xaf]
      );
      await updateUserState(client, user.id, "AWAITING_QUOTE_CONFIRMATION", { transferId, quoteId: quoteResult.rows[0].id });
      await enqueueText(client, user.id, normalizedMsisdn, message(language, "quote", {
        name: transfer.account_name,
        principal: formatInteger(amounts.principalXaf, language),
        fee: formatInteger(amounts.feeXaf, language),
        total: formatInteger(amounts.totalChargeXaf, language),
        rate: Number(rate.ngn_per_xaf).toFixed(4),
        ngn: formatInteger(amounts.recipientNgn, language),
        expires: expiresAt.toLocaleTimeString(language === "fr" ? "fr-FR" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Douala" })
      }));
      return;
    }

    case "AWAITING_QUOTE_CONFIRMATION": {
      if (noCommands.has(command)) {
        await client.query("UPDATE quotes SET status = 'CANCELLED' WHERE id = $1 AND status = 'ACTIVE'", [context.quoteId]);
        await client.query("UPDATE transfers SET status = 'CANCELLED', updated_at = now() WHERE id = $1 AND status = 'AWAITING_CONFIRMATION'", [context.transferId]);
        await updateUserState(client, user.id, "READY");
        await enqueueText(client, user.id, normalizedMsisdn, message(language, "cancelled"));
        return;
      }
      if (!yesCommands.has(command)) {
        await enqueueText(client, user.id, normalizedMsisdn, message(language, "unsupported"));
        return;
      }
      const result = await client.query(
        `SELECT t.*, q.expires_at, q.status AS quote_status
         FROM transfers t JOIN quotes q ON q.id = t.quote_id
         WHERE t.id = $1 AND t.user_id = $2 FOR UPDATE`,
        [context.transferId, user.id]
      );
      const transfer = result.rows[0];
      if (!transfer || transfer.status !== "AWAITING_CONFIRMATION" || transfer.quote_status !== "ACTIVE") {
        throw new Error("Quote is no longer active");
      }
      if (new Date(transfer.expires_at).getTime() <= Date.now()) {
        await client.query("UPDATE quotes SET status = 'EXPIRED' WHERE id = $1", [transfer.quote_id]);
        await client.query("UPDATE transfers SET status = 'CANCELLED', updated_at = now() WHERE id = $1", [transfer.id]);
        await updateUserState(client, user.id, "READY");
        await enqueueText(client, user.id, normalizedMsisdn, message(language, "cancelled"));
        return;
      }
      assertTransition("AWAITING_CONFIRMATION", "PAYMENT_PENDING");
      const referenceId = newExternalId();
      await client.query("UPDATE quotes SET status = 'ACCEPTED' WHERE id = $1", [transfer.quote_id]);
      await client.query(
        `UPDATE transfers SET status = 'PAYMENT_PENDING', mtn_reference_id = $2, mtn_status = 'PENDING',
         payment_requested_at = now(), updated_at = now(), version = version + 1 WHERE id = $1`,
        [transfer.id, referenceId]
      );
      await updateUserState(client, user.id, "AWAITING_MTN_PAYMENT", { transferId: transfer.id });
      await audit(client, {
        actorType: "USER", actorId: user.id, action: "PAYMENT_AUTHORIZED",
        entityType: "TRANSFER", entityId: transfer.id,
        metadata: { totalChargeXaf: Number(transfer.total_charge_xaf), payerMsisdn: normalizedMsisdn }
      });
      return {
        transferId: transfer.id,
        userId: user.id,
        language,
        msisdn: normalizedMsisdn,
        referenceId,
        externalId: transfer.reference,
        amountXaf: Number(transfer.total_charge_xaf)
      };
    }

    case "AWAITING_BENEFICIARY_VERIFICATION":
      await enqueueText(client, user.id, normalizedMsisdn, message(language, "accountPending"));
      return;
    case "AWAITING_MTN_PAYMENT":
      await enqueueText(client, user.id, normalizedMsisdn, message(language, "paymentPrompt", { msisdn: normalizedMsisdn }));
      return;
    default:
      await updateUserState(client, user.id, "READY");
      await enqueueText(client, user.id, normalizedMsisdn, message(language, "menu"));
  }
}

export async function handleIncomingMessage(input: {
  providerMessageId: string;
  msisdn: string;
  text: string;
}): Promise<void> {
  const action = await withTransaction((client) => processMessage(client, input));
  if (!action) return;
  try {
    await requestToPay({
      referenceId: action.referenceId,
      externalId: action.externalId,
      amountXaf: action.amountXaf,
      payerMsisdn: action.msisdn
    });
    await withTransaction(async (client) => {
      await enqueueText(client, action.userId, action.msisdn, message(action.language, "paymentPrompt", { msisdn: action.msisdn }));
    });
  } catch (error) {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE transfers SET status = 'PAYMENT_FAILED', mtn_status = 'FAILED', failure_reason = $2,
         updated_at = now(), version = version + 1 WHERE id = $1 AND status = 'PAYMENT_PENDING'`,
        [action.transferId, error instanceof Error ? error.message : String(error)]
      );
      await updateUserState(client, action.userId, "READY");
      await enqueueText(client, action.userId, action.msisdn, message(action.language, "paymentFailed"));
    });
  }
}
