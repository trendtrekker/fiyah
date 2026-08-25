export type QuoteAmounts = {
  principalXaf: number;
  feeXaf: number;
  totalChargeXaf: number;
  recipientNgn: number;
};

export function calculateQuote(principalXaf: number, rateNgnPerXaf: number, feeBps: number): QuoteAmounts {
  if (!Number.isInteger(principalXaf) || principalXaf <= 0) {
    throw new Error("Principal must be a positive whole XAF amount");
  }
  if (!Number.isFinite(rateNgnPerXaf) || rateNgnPerXaf <= 0) {
    throw new Error("Exchange rate must be positive");
  }
  if (!Number.isInteger(feeBps) || feeBps < 0) {
    throw new Error("Fee basis points must be a non-negative integer");
  }

  const feeXaf = Math.ceil((principalXaf * feeBps) / 10_000);
  return {
    principalXaf,
    feeXaf,
    totalChargeXaf: principalXaf + feeXaf,
    recipientNgn: Math.floor(principalXaf * rateNgnPerXaf)
  };
}

export function assertTransferLimits(
  principalXaf: number,
  activeTransferCount: number,
  limits: { minimumXaf: number; maximumXaf: number; dailyCount: number }
): void {
  if (principalXaf < limits.minimumXaf) {
    throw new Error(`Minimum transfer is ${limits.minimumXaf} XAF`);
  }
  if (principalXaf > limits.maximumXaf) {
    throw new Error(`Maximum transfer is ${limits.maximumXaf} XAF`);
  }
  if (activeTransferCount >= limits.dailyCount) {
    throw new Error(`Daily limit of ${limits.dailyCount} transfers reached`);
  }
}
