import { describe, expect, it } from "vitest";
import { assertTransferLimits, calculateQuote } from "./money.js";

describe("calculateQuote", () => {
  it("adds FIYAH's 1.5% fee on top of the principal", () => {
    expect(calculateQuote(1_000_000, 2.7, 150)).toEqual({
      principalXaf: 1_000_000,
      feeXaf: 15_000,
      totalChargeXaf: 1_015_000,
      recipientNgn: 2_700_000
    });
  });

  it("rounds fractional XAF fees upward and NGN payouts downward", () => {
    expect(calculateQuote(10_001, 2.71234, 150)).toEqual({
      principalXaf: 10_001,
      feeXaf: 151,
      totalChargeXaf: 10_152,
      recipientNgn: 27_126
    });
  });
});

describe("assertTransferLimits", () => {
  const limits = { minimumXaf: 10_000, maximumXaf: 1_000_000, dailyCount: 5 };

  it("accepts a valid transfer", () => {
    expect(() => assertTransferLimits(250_000, 4, limits)).not.toThrow();
  });

  it("rejects a sixth active transfer", () => {
    expect(() => assertTransferLimits(250_000, 5, limits)).toThrow("Daily limit");
  });
});
