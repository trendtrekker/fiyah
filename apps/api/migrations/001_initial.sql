CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('ADMIN', 'SUPERVISOR')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_msisdn text NOT NULL UNIQUE CHECK (whatsapp_msisdn ~ '^2376[0-9]{8}$'),
  momo_msisdn text NOT NULL CHECK (momo_msisdn = whatsapp_msisdn),
  language text CHECK (language IN ('en', 'fr')),
  conversation_state text NOT NULL DEFAULT 'AWAITING_LANGUAGE',
  conversation_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  kyc_status text NOT NULL DEFAULT 'NOT_STARTED' CHECK (kyc_status IN ('NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kyc_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  encrypted_payload text NOT NULL,
  id_type text NOT NULL,
  id_number_last4 text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES admins(id),
  rejection_reason text
);

CREATE TABLE IF NOT EXISTS beneficiaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  bank_name text NOT NULL,
  bank_code text,
  encrypted_account_number text NOT NULL,
  account_number_last4 text NOT NULL,
  account_name text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  verified_at timestamptz,
  verified_by uuid REFERENCES admins(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS beneficiaries_user_idx ON beneficiaries(user_id);

CREATE TABLE IF NOT EXISTS exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ngn_per_xaf numeric(18,8) NOT NULL CHECK (ngn_per_xaf > 0),
  source_reference text NOT NULL,
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'APPROVED', 'SUPERSEDED', 'REJECTED')),
  effective_at timestamptz,
  proposed_by uuid NOT NULL REFERENCES admins(id),
  approved_by uuid REFERENCES admins(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  CHECK (approved_by IS NULL OR approved_by <> proposed_by)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_approved_exchange_rate_idx
  ON exchange_rates ((status)) WHERE status = 'APPROVED';

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  beneficiary_id uuid NOT NULL REFERENCES beneficiaries(id),
  exchange_rate_id uuid NOT NULL REFERENCES exchange_rates(id),
  rate_ngn_per_xaf numeric(18,8) NOT NULL,
  principal_xaf bigint NOT NULL CHECK (principal_xaf > 0),
  fee_bps integer NOT NULL CHECK (fee_bps >= 0),
  fee_xaf bigint NOT NULL CHECK (fee_xaf >= 0),
  total_charge_xaf bigint NOT NULL CHECK (total_charge_xaf = principal_xaf + fee_xaf),
  recipient_ngn bigint NOT NULL CHECK (recipient_ngn > 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ACCEPTED', 'EXPIRED', 'CANCELLED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id),
  beneficiary_id uuid NOT NULL REFERENCES beneficiaries(id),
  quote_id uuid REFERENCES quotes(id),
  status text NOT NULL,
  principal_xaf bigint,
  fee_xaf bigint,
  total_charge_xaf bigint,
  recipient_ngn bigint,
  rate_ngn_per_xaf numeric(18,8),
  purpose text,
  relationship text,
  mtn_reference_id uuid UNIQUE,
  mtn_financial_transaction_id text,
  mtn_status text,
  payment_requested_at timestamptz,
  paid_at timestamptz,
  payout_due_at timestamptz,
  claimed_by uuid REFERENCES admins(id),
  claimed_at timestamptz,
  payout_reference text,
  payout_proof_url text,
  completed_at timestamptz,
  failure_reason text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transfers_user_created_idx ON transfers(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transfers_status_idx ON transfers(status, created_at);
CREATE INDEX IF NOT EXISTS transfers_payout_due_idx ON transfers(payout_due_at) WHERE status IN ('PAID', 'PAYOUT_IN_PROGRESS');

CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL UNIQUE REFERENCES transfers(id),
  amount_xaf bigint NOT NULL CHECK (amount_xaf > 0),
  status text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'COMPLETED', 'REJECTED')),
  requested_by uuid NOT NULL REFERENCES admins(id),
  approved_by uuid REFERENCES admins(id),
  refund_reference text,
  reason text NOT NULL,
  due_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  completed_at timestamptz,
  CHECK (approved_by IS NULL OR approved_by <> requested_by)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS message_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  recipient_msisdn text NOT NULL,
  message_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  provider_message_id text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_outbox_pending_idx ON message_outbox(status, created_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type text NOT NULL CHECK (actor_type IN ('USER', 'ADMIN', 'SYSTEM', 'PROVIDER')),
  actor_id text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_entity_idx ON audit_events(entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
