import { apiFetch } from "../lib/api";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3500/api/v1";

export async function readApi<T>(input: string, init: RequestInit = {}) {
  const response = await apiFetch(input, init);
  const text = await response.text();
  let payload: T | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as T;
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && payload !== null && "message" in payload
        ? String((payload as { message?: unknown }).message ?? "")
        : text;
    throw new Error(message || `Request failed with ${response.status}.`);
  }
  return payload as T;
}

export function jsonRequest(body: unknown, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    body: JSON.stringify(body),
  };
}

export function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
