import { z } from "zod";

const emptyToUndefined = (value: unknown) => value === "" ? undefined : value;

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  PUBLIC_APP_URL: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1).default("postgres://fiyah:fiyah@localhost:5432/fiyah"),
  ADMIN_SESSION_SECRET: z.string().min(32).default("development-only-session-secret-change-me"),
  FIELD_ENCRYPTION_KEY: z.preprocess(emptyToUndefined, z.string().regex(/^[a-fA-F0-9]{64}$/).optional()),
  WHATSAPP_ACCESS_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
  WHATSAPP_PHONE_NUMBER_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  WHATSAPP_VERIFY_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
  WHATSAPP_APP_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  WHATSAPP_API_VERSION: z.string().default("v23.0"),
  CRON_SECRET: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
  MTN_COLLECTION_SUBSCRIPTION_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  MTN_API_USER: z.preprocess(emptyToUndefined, z.string().optional()),
  MTN_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  MTN_TARGET_ENVIRONMENT: z.string().default("sandbox"),
  // MTN's shared sandbox processes collection requests in EUR. FIYAH's
  // customer-facing amounts and production collection currency remain XAF.
  MTN_SANDBOX_COLLECTION_CURRENCY: z.string().length(3).default("EUR"),
  MTN_BASE_URL: z.string().url().default("https://sandbox.momodeveloper.mtn.com"),
  MTN_CALLBACK_URL: z.string().url().default("http://localhost:4000/webhooks/mtn"),
  FIYAH_SERVICE_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(150),
  FIYAH_MIN_TRANSFER_XAF: z.coerce.number().int().positive().default(10_000),
  FIYAH_MAX_TRANSFER_XAF: z.coerce.number().int().positive().default(1_000_000),
  FIYAH_DAILY_TRANSFER_LIMIT: z.coerce.number().int().positive().default(5),
  FIYAH_QUOTE_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  FIYAH_PAYOUT_SLA_MINUTES: z.coerce.number().int().positive().default(15),
  FIYAH_REFUND_SLA_MINUTES: z.coerce.number().int().positive().default(60)
});

export type Config = z.infer<typeof schema> & {
  whatsappMode: "cloud" | "simulator";
  mtnMode: "sandbox" | "simulator";
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env);
  const whatsappConfigured = Boolean(parsed.WHATSAPP_ACCESS_TOKEN && parsed.WHATSAPP_PHONE_NUMBER_ID);
  const mtnConfigured = Boolean(
    parsed.MTN_COLLECTION_SUBSCRIPTION_KEY && parsed.MTN_API_USER && parsed.MTN_API_KEY
  );

  if (parsed.NODE_ENV === "production") {
    if (!whatsappConfigured) throw new Error("WhatsApp Cloud API credentials are required in production");
    if (!mtnConfigured) throw new Error("MTN MoMo credentials are required in production");
    if (!parsed.FIELD_ENCRYPTION_KEY) throw new Error("FIELD_ENCRYPTION_KEY is required in production");
  }

  return {
    ...parsed,
    whatsappMode: whatsappConfigured ? "cloud" : "simulator",
    mtnMode: mtnConfigured ? "sandbox" : "simulator"
  };
}

export const config = loadConfig();
