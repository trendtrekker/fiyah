import bcrypt from "bcryptjs";
import { pool } from "./db.js";

if (process.env.NODE_ENV === "production") {
  throw new Error("Development seed accounts must never be created in production");
}

const administrators = [
  {
    email: process.env.SEED_ADMIN_ONE_EMAIL ?? "admin1@fiyah.local",
    password: process.env.SEED_ADMIN_ONE_PASSWORD ?? "ChangeMe123!",
    name: "FIYAH Admin One",
    role: "SUPERVISOR"
  },
  {
    email: process.env.SEED_ADMIN_TWO_EMAIL ?? "admin2@fiyah.local",
    password: process.env.SEED_ADMIN_TWO_PASSWORD ?? "ChangeMe456!",
    name: "FIYAH Admin Two",
    role: "ADMIN"
  }
];

async function seed(): Promise<void> {
  for (const administrator of administrators) {
    const passwordHash = await bcrypt.hash(administrator.password, 12);
    await pool.query(
      `INSERT INTO admins(email, display_name, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         active = true`,
      [administrator.email.toLowerCase(), administrator.name, passwordHash, administrator.role]
    );
  }
  console.log("Seeded FIYAH development administrators");
  await pool.end();
}

seed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
