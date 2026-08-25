import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyKycToken } from "../auth.js";
import { encryptField } from "../crypto.js";
import { pool, withTransaction } from "../db.js";
import { message, type Language } from "../i18n.js";
import { enqueueText } from "../services/outbox.js";

const kycSchema = z.object({
  token: z.string().min(20),
  legalName: z.string().min(3).max(150),
  dateOfBirth: z.iso.date(),
  nationality: z.string().min(2).max(80),
  residentialAddress: z.string().min(10).max(300),
  idType: z.enum(["CAMEROON_NATIONAL_ID", "PASSPORT"]),
  idNumber: z.string().min(4).max(50),
  occupation: z.string().min(2).max(100),
  sourceOfFunds: z.string().min(2).max(150),
  idDocumentReference: z.string().min(2).max(500),
  selfieReference: z.string().min(2).max(500),
  consent: z.literal(true)
});

export async function registerPublicRoutes(app: FastifyInstance): Promise<void> {
  app.post("/public/kyc/validate", async (request, reply) => {
    const body = z.object({ token: z.string() }).parse(request.body);
    try {
      const userId = await verifyKycToken(body.token);
      const result = await pool.query(
        "SELECT whatsapp_msisdn, kyc_status FROM users WHERE id = $1 AND active = true",
        [userId]
      );
      if (!result.rows[0]) return reply.code(404).send({ error: "User not found" });
      return { valid: true, msisdn: `+${result.rows[0].whatsapp_msisdn}`, status: result.rows[0].kyc_status };
    } catch {
      return reply.code(400).send({ error: "This verification link is invalid or expired" });
    }
  });

  app.post("/public/kyc", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request, reply) => {
    const body = kycSchema.parse(request.body);
    let userId: string;
    try {
      userId = await verifyKycToken(body.token);
    } catch {
      return reply.code(400).send({ error: "This verification link is invalid or expired" });
    }
    const payload = { ...body, token: undefined, consentedAt: new Date().toISOString() };
    await withTransaction(async (client) => {
      const result = await client.query("SELECT * FROM users WHERE id = $1 AND active = true FOR UPDATE", [userId]);
      const user = result.rows[0];
      if (!user) throw new Error("User not found");
      if (user.kyc_status === "APPROVED") throw new Error("KYC is already approved");
      await client.query(
        `INSERT INTO kyc_profiles(user_id, encrypted_payload, id_type, id_number_last4, status)
         VALUES ($1, $2, $3, $4, 'PENDING')
         ON CONFLICT (user_id) DO UPDATE SET encrypted_payload = EXCLUDED.encrypted_payload,
           id_type = EXCLUDED.id_type, id_number_last4 = EXCLUDED.id_number_last4,
           status = 'PENDING', submitted_at = now(), reviewed_at = NULL, reviewed_by = NULL, rejection_reason = NULL`,
        [userId, encryptField(JSON.stringify(payload)), body.idType, body.idNumber.slice(-4)]
      );
      await client.query(
        "UPDATE users SET kyc_status = 'PENDING', conversation_state = 'KYC_PENDING', updated_at = now() WHERE id = $1",
        [userId]
      );
      await enqueueText(client, userId, user.whatsapp_msisdn, message((user.language ?? "en") as Language, "kycPending"));
    });
    return reply.code(202).send({ accepted: true });
  });
}
