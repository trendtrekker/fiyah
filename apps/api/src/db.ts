import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error", error);
});

export type DbClient = pg.PoolClient;

export async function withTransaction<T>(work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function audit(
  client: DbClient,
  event: {
    actorType: "USER" | "ADMIN" | "SYSTEM" | "PROVIDER";
    actorId?: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
      (actor_type, actor_id, action, entity_type, entity_id, metadata, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      event.actorType,
      event.actorId ?? null,
      event.action,
      event.entityType,
      event.entityId,
      JSON.stringify(event.metadata ?? {}),
      event.ipAddress ?? null
    ]
  );
}
