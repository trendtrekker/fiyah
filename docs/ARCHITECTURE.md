# FIYAH architecture

## Transaction flow

```text
WhatsApp customer
      │
      ▼
WhatsApp Cloud API webhook ──► FIYAH conversation state machine
                                      │
                     ┌────────────────┼────────────────┐
                     ▼                ▼                ▼
               KYC review      Daily rate/quote   Beneficiary review
                     └────────────────┼────────────────┘
                                      ▼
                            MTN Request-to-Pay
                                      │
                         callback + status polling
                                      ▼
                                PAID queue
                                      │
                                      ▼
                          Manual Nigerian payout
                                      │
                          ┌───────────┴───────────┐
                          ▼                       ▼
                     COMPLETED             REFUND_PENDING
                                                  │
                                            dual approval
                                                  ▼
                                              REFUNDED
```

## Services

- `apps/api`: webhooks, conversation orchestration, MTN adapter, ledger and administrator API.
- `apps/web`: operator console, KYC form and local WhatsApp/MTN simulator.
- PostgreSQL: authoritative state, encrypted KYC/account data, quotes, payouts, refunds, outbox and audit events.
- Background workers: WhatsApp outbox delivery and MTN pending-payment reconciliation.

## Safety invariants

1. A WhatsApp customer statement never establishes payment success. Only an independently fetched MTN status can transition `PAYMENT_PENDING` to `PAID`.
2. WhatsApp and MoMo MSISDN values are identical and constrained to Cameroon `2376…` format.
3. A beneficiary must be manually verified before a quote or MoMo request is created.
4. A quote snapshots the approved exchange rate, fee and amounts; later rate changes cannot modify it.
5. Duplicate WhatsApp webhook IDs are rejected through a unique provider-event constraint.
6. The MTN reference is unique and callbacks are reconciliation triggers, not trusted payment evidence.
7. A paid transfer can be claimed once. Only its claiming administrator can complete or fail the payout.
8. The administrator requesting a refund cannot approve it.
9. A completed transfer has no transition to refund or another payout.
10. KYC and full bank-account numbers are encrypted at rest and masked in queues.

## Key statuses

```text
ACCOUNT_VERIFICATION_PENDING
        │ account verified
        ▼
AWAITING_CONFIRMATION
        │ live quote accepted
        ▼
PAYMENT_PENDING
   │ MTN success       │ MTN failure
   ▼                   ▼
PAID             PAYMENT_FAILED
   │ claimed
   ▼
PAYOUT_IN_PROGRESS
   │ completed         │ failed
   ▼                   ▼
COMPLETED         PAYOUT_FAILED
                         │ refund requested
                         ▼
                   REFUND_PENDING
                         │ dual approval + completion
                         ▼
                     REFUNDED
```

## Production evolution

- Replace sandbox document references with a KYC provider or encrypted object storage.
- Add Nigerian bank account-resolution and payout APIs when FIYAH moves beyond manual operations.
- Run outbox and reconciliation workers as separately supervised processes.
- Add template-aware WhatsApp notifications outside Meta's permitted customer-service window.
- Integrate sanctions/PEP screening, transaction monitoring and compliance case management.
- Store keys in a managed secrets service and rotate them under a documented procedure.
- Add database point-in-time recovery, multi-zone deployment, on-call alerting and reconciliation exports.
