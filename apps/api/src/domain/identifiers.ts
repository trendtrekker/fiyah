import { randomUUID } from "node:crypto";

export function normalizeCameroonMsisdn(input: string): string {
  const digits = input.replace(/\D/g, "");
  const normalized = digits.startsWith("237") ? digits : `237${digits.replace(/^0/, "")}`;
  if (!/^2376\d{8}$/.test(normalized)) {
    throw new Error("A valid Cameroon mobile number is required");
  }
  return normalized;
}

export function newExternalId(): string {
  return randomUUID();
}

export function newHumanReference(now = new Date()): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `FIY-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}
