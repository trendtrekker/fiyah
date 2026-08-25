export const transferStatuses = [
  "DRAFT",
  "ACCOUNT_VERIFICATION_PENDING",
  "AWAITING_CONFIRMATION",
  "PAYMENT_PENDING",
  "PAID",
  "PAYOUT_IN_PROGRESS",
  "COMPLETED",
  "PAYMENT_FAILED",
  "PAYOUT_FAILED",
  "REFUND_PENDING",
  "REFUNDED",
  "CANCELLED"
] as const;

export type TransferStatus = typeof transferStatuses[number];

const allowedTransitions: Record<TransferStatus, readonly TransferStatus[]> = {
  DRAFT: ["ACCOUNT_VERIFICATION_PENDING", "CANCELLED"],
  ACCOUNT_VERIFICATION_PENDING: ["AWAITING_CONFIRMATION", "CANCELLED"],
  AWAITING_CONFIRMATION: ["PAYMENT_PENDING", "CANCELLED"],
  PAYMENT_PENDING: ["PAID", "PAYMENT_FAILED", "CANCELLED"],
  PAID: ["PAYOUT_IN_PROGRESS", "PAYOUT_FAILED"],
  PAYOUT_IN_PROGRESS: ["COMPLETED", "PAYOUT_FAILED"],
  COMPLETED: [],
  PAYMENT_FAILED: [],
  PAYOUT_FAILED: ["REFUND_PENDING", "PAYOUT_IN_PROGRESS"],
  REFUND_PENDING: ["REFUNDED"],
  REFUNDED: [],
  CANCELLED: []
};

export function assertTransition(from: TransferStatus, to: TransferStatus): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new Error(`Invalid transfer transition: ${from} -> ${to}`);
  }
}

export const conversationStates = [
  "NEW",
  "AWAITING_LANGUAGE",
  "KYC_REQUIRED",
  "KYC_PENDING",
  "READY",
  "AWAITING_BANK",
  "AWAITING_ACCOUNT_NUMBER",
  "AWAITING_RELATIONSHIP",
  "AWAITING_PURPOSE",
  "AWAITING_BENEFICIARY_VERIFICATION",
  "AWAITING_BENEFICIARY_CONFIRMATION",
  "AWAITING_AMOUNT",
  "AWAITING_QUOTE_CONFIRMATION",
  "AWAITING_MTN_PAYMENT"
] as const;

export type ConversationState = typeof conversationStates[number];
