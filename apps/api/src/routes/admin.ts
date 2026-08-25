import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticateAdmin, createAdminToken, requireAdmin } from "../auth.js";
import { config } from "../config.js";
import { decryptField } from "../crypto.js";
import { audit, pool, withTransaction } from "../db.js";
import { assertTransition } from "../domain/states.js";
import { message, type Language } from "../i18n.js";
import { enqueueText } from "../services/outbox.js";

const idParams = z.object({ id: z.string().uuid() });

function adminId(request: FastifyRequest): string {
  if (!request.admin) throw new Error("Administrator session missing");
  return request.admin.id;
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.post("/admin/auth/login", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const body = z.object({ email: z.email(), password: z.string().min(8) }).parse(request.body);
    const administrator = await authenticateAdmin(body.email, body.password);
    if (!administrator) return reply.code(401).send({ error: "Invalid email or password" });
    const token = await createAdminToken(administrator);
    reply.setCookie("fiyah_admin", token, {
      path: "/",
      httpOnly: true,
      secure: config.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 12 * 60 * 60
    });
    return { administrator };
  });

  app.post("/admin/auth/logout", async (_request, reply) => {
    reply.clearCookie("fiyah_admin", { path: "/" });
    return { ok: true };
  });

  app.get("/admin/auth/me", { preHandler: requireAdmin }, async (request) => ({ administrator: request.admin }));

  app.get("/admin/dashboard", { preHandler: requireAdmin }, async () => {
    const [counts, due, activeRate] = await Promise.all([
      pool.query(`SELECT status, count(*)::int AS count FROM transfers GROUP BY status`),
      pool.query(`SELECT count(*)::int AS overdue FROM transfers
        WHERE status IN ('PAID', 'PAYOUT_IN_PROGRESS') AND payout_due_at < now()`),
      pool.query("SELECT id, ngn_per_xaf, effective_at, approved_at FROM exchange_rates WHERE status = 'APPROVED' LIMIT 1")
    ]);
    return {
      counts: Object.fromEntries(counts.rows.map((row) => [row.status, row.count])),
      overdue: due.rows[0].overdue,
      activeRate: activeRate.rows[0] ?? null,
      serviceFeeBps: config.FIYAH_SERVICE_FEE_BPS,
      payoutSlaMinutes: config.FIYAH_PAYOUT_SLA_MINUTES
    };
  });

  app.get("/admin/kyc", { preHandler: requireAdmin }, async (request) => {
    const query = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]).default("PENDING") }).parse(request.query);
    const result = await pool.query(
      `SELECT k.id, k.user_id, k.id_type, k.id_number_last4, k.status, k.submitted_at,
              u.whatsapp_msisdn, u.language
       FROM kyc_profiles k JOIN users u ON u.id = k.user_id
       WHERE k.status = $1 ORDER BY k.submitted_at`,
      [query.status]
    );
    return { items: result.rows };
  });

  app.get("/admin/kyc/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const result = await pool.query(
      `SELECT k.*, u.whatsapp_msisdn FROM kyc_profiles k JOIN users u ON u.id = k.user_id WHERE k.id = $1`,
      [id]
    );
    if (!result.rows[0]) return reply.code(404).send({ error: "KYC profile not found" });
    const row = result.rows[0];
    return { ...row, payload: JSON.parse(decryptField(row.encrypted_payload)), encrypted_payload: undefined };
  });

  app.post("/admin/kyc/:id/decision", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), reason: z.string().max(300).optional() }).parse(request.body);
    if (body.decision === "REJECTED" && !body.reason) return reply.code(400).send({ error: "A rejection reason is required" });
    await withTransaction(async (client) => {
      const result = await client.query(
        `SELECT k.*, u.whatsapp_msisdn, COALESCE(u.language, 'en') AS language
         FROM kyc_profiles k JOIN users u ON u.id = k.user_id WHERE k.id = $1 FOR UPDATE`,
        [id]
      );
      const kyc = result.rows[0];
      if (!kyc || kyc.status !== "PENDING") throw new Error("KYC profile is not pending");
      await client.query(
        `UPDATE kyc_profiles SET status = $2, reviewed_at = now(), reviewed_by = $3, rejection_reason = $4 WHERE id = $1`,
        [id, body.decision, adminId(request), body.reason ?? null]
      );
      await client.query(
        `UPDATE users SET kyc_status = $2, conversation_state = $3, updated_at = now() WHERE id = $1`,
        [kyc.user_id, body.decision, body.decision === "APPROVED" ? "READY" : "KYC_REQUIRED"]
      );
      if (body.decision === "APPROVED") {
        await enqueueText(client, kyc.user_id, kyc.whatsapp_msisdn, message(kyc.language as Language, "kycApproved"));
      }
      await audit(client, {
        actorType: "ADMIN", actorId: adminId(request), action: `KYC_${body.decision}`,
        entityType: "KYC", entityId: id, metadata: { reason: body.reason }
      });
    });
    return { ok: true };
  });

  app.get("/admin/beneficiaries", { preHandler: requireAdmin }, async (request) => {
    const query = z.object({ status: z.enum(["PENDING", "VERIFIED", "REJECTED"]).default("PENDING") }).parse(request.query);
    const result = await pool.query(
      `SELECT b.id, b.user_id, b.bank_name, b.bank_code, b.account_number_last4, b.account_name,
              b.status, b.created_at, u.whatsapp_msisdn
       FROM beneficiaries b JOIN users u ON u.id = b.user_id
       WHERE b.status = $1 ORDER BY b.created_at`,
      [query.status]
    );
    return { items: result.rows };
  });

  app.get("/admin/beneficiaries/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const result = await pool.query("SELECT * FROM beneficiaries WHERE id = $1", [id]);
    const beneficiary = result.rows[0];
    if (!beneficiary) return reply.code(404).send({ error: "Beneficiary not found" });
    return { ...beneficiary, account_number: decryptField(beneficiary.encrypted_account_number), encrypted_account_number: undefined };
  });

  app.post("/admin/beneficiaries/:id/verify", { preHandler: requireAdmin }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = z.object({ accountName: z.string().min(3).max(150), bankCode: z.string().max(20).optional() }).parse(request.body);
    await withTransaction(async (client) => {
      const result = await client.query(
        `SELECT b.*, u.whatsapp_msisdn, COALESCE(u.language, 'en') AS language,
                t.id AS transfer_id, t.status AS transfer_status
         FROM beneficiaries b JOIN users u ON u.id = b.user_id
         JOIN transfers t ON t.beneficiary_id = b.id
         WHERE b.id = $1 AND t.status = 'ACCOUNT_VERIFICATION_PENDING'
         ORDER BY t.created_at DESC LIMIT 1 FOR UPDATE OF b, t`,
        [id]
      );
      const beneficiary = result.rows[0];
      if (!beneficiary || beneficiary.status !== "PENDING") throw new Error("Beneficiary is not pending verification");
      assertTransition("ACCOUNT_VERIFICATION_PENDING", "AWAITING_CONFIRMATION");
      await client.query(
        `UPDATE beneficiaries SET status = 'VERIFIED', account_name = $2, bank_code = $3,
         verified_at = now(), verified_by = $4, updated_at = now() WHERE id = $1`,
        [id, body.accountName.toUpperCase(), body.bankCode ?? null, adminId(request)]
      );
      await client.query("UPDATE transfers SET status = 'AWAITING_CONFIRMATION', updated_at = now() WHERE id = $1", [beneficiary.transfer_id]);
      await client.query(
        `UPDATE users SET conversation_state = 'AWAITING_BENEFICIARY_CONFIRMATION',
         conversation_context = $2, updated_at = now() WHERE id = $1`,
        [beneficiary.user_id, JSON.stringify({ transferId: beneficiary.transfer_id })]
      );
      await enqueueText(client, beneficiary.user_id, beneficiary.whatsapp_msisdn, message(beneficiary.language as Language, "accountVerified", {
        name: body.accountName.toUpperCase(), bank: beneficiary.bank_name, last4: beneficiary.account_number_last4
      }));
      await audit(client, {
        actorType: "ADMIN", actorId: adminId(request), action: "BENEFICIARY_VERIFIED",
        entityType: "BENEFICIARY", entityId: id, metadata: { accountName: body.accountName.toUpperCase() }
      });
    });
    return { ok: true };
  });

  app.get("/admin/rates", { preHandler: requireAdmin }, async () => {
    const result = await pool.query(
      `SELECT r.*, p.display_name AS proposed_by_name, a.display_name AS approved_by_name
       FROM exchange_rates r JOIN admins p ON p.id = r.proposed_by
       LEFT JOIN admins a ON a.id = r.approved_by ORDER BY r.created_at DESC LIMIT 50`
    );
    return { items: result.rows };
  });

  app.post("/admin/rates", { preHandler: requireAdmin }, async (request) => {
    const body = z.object({ ngnPerXaf: z.coerce.number().positive(), sourceReference: z.string().min(3).max(300) }).parse(request.body);
    const result = await pool.query(
      `INSERT INTO exchange_rates(ngn_per_xaf, source_reference, proposed_by)
       VALUES ($1, $2, $3) RETURNING *`,
      [body.ngnPerXaf, body.sourceReference, adminId(request)]
    );
    return { item: result.rows[0] };
  });

  app.post("/admin/rates/:id/approve", { preHandler: requireAdmin }, async (request) => {
    const { id } = idParams.parse(request.params);
    await withTransaction(async (client) => {
      const result = await client.query("SELECT * FROM exchange_rates WHERE id = $1 FOR UPDATE", [id]);
      const rate = result.rows[0];
      if (!rate || rate.status !== "PROPOSED") throw new Error("Rate is not awaiting approval");
      if (rate.proposed_by === adminId(request)) throw new Error("A different administrator must approve the rate");
      await client.query("UPDATE exchange_rates SET status = 'SUPERSEDED' WHERE status = 'APPROVED'");
      await client.query(
        `UPDATE exchange_rates SET status = 'APPROVED', approved_by = $2,
         approved_at = now(), effective_at = now() WHERE id = $1`,
        [id, adminId(request)]
      );
      await audit(client, {
        actorType: "ADMIN", actorId: adminId(request), action: "RATE_APPROVED",
        entityType: "EXCHANGE_RATE", entityId: id, metadata: { ngnPerXaf: rate.ngn_per_xaf }
      });
    });
    return { ok: true };
  });

  app.get("/admin/transfers", { preHandler: requireAdmin }, async (request) => {
    const query = z.object({ status: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }).parse(request.query);
    const params: unknown[] = [];
    let filter = "";
    if (query.status) {
      params.push(query.status);
      filter = `WHERE t.status = $${params.length}`;
    }
    params.push(query.limit);
    const result = await pool.query(
      `SELECT t.*, u.whatsapp_msisdn, b.bank_name, b.account_number_last4, b.account_name,
              a.display_name AS claimed_by_name
       FROM transfers t JOIN users u ON u.id = t.user_id
       JOIN beneficiaries b ON b.id = t.beneficiary_id
       LEFT JOIN admins a ON a.id = t.claimed_by
       ${filter} ORDER BY t.created_at DESC LIMIT $${params.length}`,
      params
    );
    return { items: result.rows };
  });

  app.post("/admin/transfers/:id/claim", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const result = await pool.query(
      `UPDATE transfers SET status = 'PAYOUT_IN_PROGRESS', claimed_by = $2, claimed_at = now(),
       updated_at = now(), version = version + 1
       WHERE id = $1 AND status = 'PAID' AND claimed_by IS NULL RETURNING *`,
      [id, adminId(request)]
    );
    if (!result.rows[0]) return reply.code(409).send({ error: "Transfer is no longer available to claim" });
    return { item: result.rows[0] };
  });

  app.post("/admin/transfers/:id/complete", { preHandler: requireAdmin }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = z.object({ payoutReference: z.string().min(3).max(150), proofUrl: z.url().optional() }).parse(request.body);
    await withTransaction(async (client) => {
      const result = await client.query(
        `SELECT t.*, u.whatsapp_msisdn, COALESCE(u.language, 'en') AS language, b.account_name
         FROM transfers t JOIN users u ON u.id = t.user_id JOIN beneficiaries b ON b.id = t.beneficiary_id
         WHERE t.id = $1 FOR UPDATE`,
        [id]
      );
      const transfer = result.rows[0];
      if (!transfer || transfer.status !== "PAYOUT_IN_PROGRESS") throw new Error("Transfer is not in payout");
      if (transfer.claimed_by !== adminId(request)) throw new Error("Only the administrator who claimed this transfer can complete it");
      assertTransition("PAYOUT_IN_PROGRESS", "COMPLETED");
      await client.query(
        `UPDATE transfers SET status = 'COMPLETED', payout_reference = $2, payout_proof_url = $3,
         completed_at = now(), updated_at = now(), version = version + 1 WHERE id = $1`,
        [id, body.payoutReference, body.proofUrl ?? null]
      );
      await enqueueText(client, transfer.user_id, transfer.whatsapp_msisdn, message(transfer.language as Language, "completed", {
        ngn: Number(transfer.recipient_ngn).toLocaleString(), name: transfer.account_name,
        payoutReference: body.payoutReference, reference: transfer.reference
      }));
      await audit(client, {
        actorType: "ADMIN", actorId: adminId(request), action: "PAYOUT_COMPLETED",
        entityType: "TRANSFER", entityId: id, metadata: { payoutReference: body.payoutReference }
      });
    });
    return { ok: true };
  });

  app.post("/admin/transfers/:id/fail", { preHandler: requireAdmin }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = z.object({ reason: z.string().min(3).max(300) }).parse(request.body);
    await withTransaction(async (client) => {
      const result = await client.query(
        `SELECT t.*, u.whatsapp_msisdn, COALESCE(u.language, 'en') AS language
         FROM transfers t JOIN users u ON u.id = t.user_id WHERE t.id = $1 FOR UPDATE`,
        [id]
      );
      const transfer = result.rows[0];
      if (!transfer || !["PAID", "PAYOUT_IN_PROGRESS"].includes(transfer.status)) throw new Error("Transfer cannot be failed from its current status");
      if (transfer.status === "PAYOUT_IN_PROGRESS" && transfer.claimed_by !== adminId(request)) {
        throw new Error("Only the claiming administrator can fail this payout");
      }
      assertTransition(transfer.status, "PAYOUT_FAILED");
      await client.query(
        `UPDATE transfers SET status = 'PAYOUT_FAILED', failure_reason = $2,
         updated_at = now(), version = version + 1 WHERE id = $1`,
        [id, body.reason]
      );
      await enqueueText(client, transfer.user_id, transfer.whatsapp_msisdn, message(transfer.language as Language, "payoutFailed"));
    });
    return { ok: true };
  });

  app.post("/admin/transfers/:id/refund", { preHandler: requireAdmin }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = z.object({ reason: z.string().min(3).max(300) }).parse(request.body);
    await withTransaction(async (client) => {
      const result = await client.query("SELECT * FROM transfers WHERE id = $1 FOR UPDATE", [id]);
      const transfer = result.rows[0];
      if (!transfer || transfer.status !== "PAYOUT_FAILED") throw new Error("Only failed payouts can be refunded");
      assertTransition("PAYOUT_FAILED", "REFUND_PENDING");
      const dueAt = new Date(Date.now() + config.FIYAH_REFUND_SLA_MINUTES * 60_000);
      await client.query(
        `INSERT INTO refunds(transfer_id, amount_xaf, requested_by, reason, due_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, transfer.total_charge_xaf, adminId(request), body.reason, dueAt]
      );
      await client.query("UPDATE transfers SET status = 'REFUND_PENDING', updated_at = now(), version = version + 1 WHERE id = $1", [id]);
    });
    return { ok: true };
  });

  app.get("/admin/refunds", { preHandler: requireAdmin }, async () => {
    const result = await pool.query(
      `SELECT r.*, t.reference AS transfer_reference, u.whatsapp_msisdn,
              requester.display_name AS requested_by_name, approver.display_name AS approved_by_name
       FROM refunds r JOIN transfers t ON t.id = r.transfer_id JOIN users u ON u.id = t.user_id
       JOIN admins requester ON requester.id = r.requested_by
       LEFT JOIN admins approver ON approver.id = r.approved_by
       ORDER BY r.created_at DESC`
    );
    return { items: result.rows };
  });

  app.post("/admin/refunds/:id/approve", { preHandler: requireAdmin }, async (request) => {
    const { id } = idParams.parse(request.params);
    const result = await pool.query(
      `UPDATE refunds SET status = 'APPROVED', approved_by = $2, approved_at = now()
       WHERE id = $1 AND status = 'PENDING_APPROVAL' AND requested_by <> $2 RETURNING *`,
      [id, adminId(request)]
    );
    if (!result.rows[0]) throw new Error("Refund requires approval by a different administrator");
    return { item: result.rows[0] };
  });

  app.post("/admin/refunds/:id/complete", { preHandler: requireAdmin }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = z.object({ refundReference: z.string().min(3).max(150) }).parse(request.body);
    await withTransaction(async (client) => {
      const result = await client.query(
        `SELECT r.*, t.user_id, t.reference, u.whatsapp_msisdn, COALESCE(u.language, 'en') AS language
         FROM refunds r JOIN transfers t ON t.id = r.transfer_id JOIN users u ON u.id = t.user_id
         WHERE r.id = $1 FOR UPDATE`,
        [id]
      );
      const refund = result.rows[0];
      if (!refund || refund.status !== "APPROVED") throw new Error("Refund is not approved");
      if (refund.approved_by !== adminId(request)) throw new Error("The approving administrator must record completion");
      assertTransition("REFUND_PENDING", "REFUNDED");
      await client.query(
        `UPDATE refunds SET status = 'COMPLETED', refund_reference = $2, completed_at = now() WHERE id = $1`,
        [id, body.refundReference]
      );
      await client.query("UPDATE transfers SET status = 'REFUNDED', updated_at = now(), version = version + 1 WHERE id = $1", [refund.transfer_id]);
      await enqueueText(client, refund.user_id, refund.whatsapp_msisdn, message(refund.language as Language, "refunded", {
        amount: Number(refund.amount_xaf).toLocaleString(), refundReference: body.refundReference
      }));
    });
    return { ok: true };
  });

  app.get("/admin/audit", { preHandler: requireAdmin }, async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(request.query);
    const result = await pool.query("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT $1", [query.limit]);
    return { items: result.rows };
  });
}
