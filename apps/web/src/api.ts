export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new ApiError(body.error ?? `Request failed (${response.status})`, response.status);
  return body as T;
}

export const post = <T>(path: string, body?: unknown) => api<T>(path, {
  method: "POST",
  body: body === undefined ? undefined : JSON.stringify(body)
});

export function formatMoney(value: string | number | null | undefined, currency: "XAF" | "NGN" = "XAF"): string {
  return `${Number(value ?? 0).toLocaleString("en-GB", { maximumFractionDigits: 0 })} ${currency}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Douala"
  }).format(new Date(value));
}
