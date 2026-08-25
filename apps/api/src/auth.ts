import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { pool } from "./db.js";

const secret = new TextEncoder().encode(config.ADMIN_SESSION_SECRET);

export type AdminSession = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "SUPERVISOR";
};

declare module "fastify" {
  interface FastifyRequest {
    admin?: AdminSession;
    rawBody?: Buffer;
  }
}

export async function authenticateAdmin(email: string, password: string): Promise<AdminSession | null> {
  const result = await pool.query(
    `SELECT id, email, display_name, password_hash, role
     FROM admins WHERE email = $1 AND active = true`,
    [email.toLowerCase()]
  );
  const row = result.rows[0];
  if (!row || !(await bcrypt.compare(password, row.password_hash))) return null;
  return { id: row.id, email: row.email, name: row.display_name, role: row.role };
}

export async function createAdminToken(admin: AdminSession): Promise<string> {
  return new SignJWT({ email: admin.email, name: admin.name, role: admin.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(admin.id)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret);
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies.fiyah_admin;
  if (!token) {
    await reply.code(401).send({ error: "Authentication required" });
    return;
  }
  try {
    const { payload } = await jwtVerify(token, secret);
    request.admin = {
      id: String(payload.sub),
      email: String(payload.email),
      name: String(payload.name),
      role: payload.role as "ADMIN" | "SUPERVISOR"
    };
  } catch {
    await reply.clearCookie("fiyah_admin", { path: "/" }).code(401).send({ error: "Session expired" });
  }
}

export async function createKycToken(userId: string): Promise<string> {
  return new SignJWT({ purpose: "kyc" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

export async function verifyKycToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, secret);
  if (payload.purpose !== "kyc" || !payload.sub) throw new Error("Invalid KYC token");
  return payload.sub;
}
