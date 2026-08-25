# FIYAH

FIYAH is a sandbox implementation of a bilingual WhatsApp-to-MTN MoMo collection workflow for Cameroon-to-Nigeria transfers. MTN confirms the XAF collection; FIYAH administrators manually verify Nigerian bank accounts, complete payouts, and record refunds.

This repository is intentionally **sandbox-first**. It cannot move real Nigerian funds and falls back to local simulators when WhatsApp or MTN credentials are absent.

## Included

- English and French WhatsApp conversation state machine
- Same-number rule for WhatsApp and Cameroon MTN MoMo
- Secure KYC link, encrypted KYC payloads, and manual review
- Manual Nigerian beneficiary/account-name verification before collection
- Daily exchange-rate maker/checker approval
- Immutable ten-minute quotes
- 1.5% service fee added above the XAF principal
- 10,000–1,000,000 XAF configurable transfer range
- Five active/successful transfers per customer per Cameroon calendar day
- MTN Request-to-Pay adapter, callback reconciliation, and polling fallback
- Fifteen-minute manual payout SLA
- Claim locking to prevent duplicate payout
- Dual-control one-hour refund workflow
- Audit events and encrypted sensitive fields
- Responsive operator console and conversation simulator

## Technology

- Node.js and TypeScript
- Fastify API
- PostgreSQL 17
- React and Vite operator/KYC interface
- AES-256-GCM field encryption
- Signed, HTTP-only administrator sessions

## Local setup

Requirements: Node.js 22+, npm, Docker Desktop.

```powershell
Copy-Item .env.example .env
docker compose up -d postgres
npm install
npm run build
npm run db:migrate
npm run db:seed
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

Development administrators:

- `admin1@fiyah.local` / `ChangeMe123!`
- `admin2@fiyah.local` / `ChangeMe456!`

These accounts exist only for local development. Change the seed credentials in `.env` and never run the seed in production.

## Sandbox walkthrough

1. Sign in as administrator one.
2. Open **Sandbox** and send `EN` or `FR` from the simulated customer.
3. Open the KYC link shown in the phone and submit the sandbox form.
4. Approve the KYC case.
5. Administrator one proposes an XAF/NGN rate; administrator two approves it.
6. Continue the customer conversation with `SEND` / `ENVOYER`.
7. Verify the beneficiary account from the operator console.
8. Approve the quote and simulate MTN `SUCCESSFUL` using the FIYAH reference.
9. Claim the paid transfer and record the Nigerian bank payout reference.

For an automated database-backed walkthrough while the API is running:

```powershell
npm run smoke
```

## External credentials

Copy the values into `.env` when they are available:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `MTN_COLLECTION_SUBSCRIPTION_KEY`
- `MTN_API_USER`
- `MTN_API_KEY`
- public HTTPS callback URLs

If credentials are omitted outside production, FIYAH uses local simulators. Production startup fails closed when credentials or the field-encryption key are missing.

## Production gates

Do not collect real customer funds until all of these are complete:

- written MTN approval to use the Collections account for the remittance use case
- legal and regulatory approval for the Cameroon-to-Nigeria operating model
- a compliant Nigerian business payout account or licensed payout partner
- negotiated MTN pricing that leaves positive unit economics at FIYAH's 1.5% fee
- production identity verification, document storage, AML and sanctions screening
- approved WhatsApp Business Account, number, templates and opt-in language
- at least five trained payout administrators plus backup coverage for a true 24/7 SLA
- production monitoring, backups, incident response, reconciliation and privacy policies

The current KYC form stores encrypted metadata and document references for sandbox testing; it does not upload or validate identity images. Integrate compliant private object storage or a KYC provider before production.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the transaction model and safety invariants.
