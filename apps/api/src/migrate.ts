import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool } from "./db.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = join(here, "..", "..", "..", "supabase", "migrations");

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();

    for (const filename of files) {
      const existing = await client.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [filename]);
      if (existing.rowCount) continue;
      const sql = await readFile(join(migrationsDirectory, filename), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(filename) VALUES ($1) ON CONFLICT DO NOTHING", [filename]);
        await client.query("COMMIT");
        console.log(`Applied ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
