import { describe, expect, it } from "vitest";
import { assertTransition } from "./states.js";

describe("transfer state transitions", () => {
  it("allows MTN success to move a payment to paid", () => {
    expect(() => assertTransition("PAYMENT_PENDING", "PAID")).not.toThrow();
  });

  it("prevents completion before payout starts", () => {
    expect(() => assertTransition("PAID", "COMPLETED")).toThrow("Invalid transfer transition");
  });

  it("prevents a completed transfer from being refunded", () => {
    expect(() => assertTransition("COMPLETED", "REFUND_PENDING")).toThrow("Invalid transfer transition");
  });
});
