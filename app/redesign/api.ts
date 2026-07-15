import { apiFetch } from "../lib/api";
import {
  FeatureLimitExceededError,
  type FeatureLimitErrorResponse,
} from "../lib/types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3500/api/v1";

function isFeatureLimitError(
  payload: unknown,
): payload is Partial<FeatureLimitErrorResponse> & { code: "FEATURE_LIMIT_EXCEEDED" } {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Partial<FeatureLimitErrorResponse>;
  return candidate.code === "FEATURE_LIMIT_EXCEEDED";
}

function normalizeFeatureLimitError(
  payload: Partial<FeatureLimitErrorResponse> & { code: "FEATURE_LIMIT_EXCEEDED" },
): FeatureLimitErrorResponse {
  return {
    code: payload.code,
    feature: typeof payload.feature === "string" ? payload.feature : "unknown",
    limit: typeof payload.limit === "number" ? payload.limit : 0,
    currentUsage: typeof payload.currentUsage === "number" ? payload.currentUsage : 0,
    tier: {
      id: typeof payload.tier?.id === "string" ? payload.tier.id : "",
      name: typeof payload.tier?.name === "string" ? payload.tier.name : "Current",
    },
    upgradeHint:
      typeof payload.upgradeHint === "string" && payload.upgradeHint
        ? payload.upgradeHint
        : "This feature is not included in your current plan.",
  };
}

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
    if (isFeatureLimitError(payload)) {
      throw new FeatureLimitExceededError(normalizeFeatureLimitError(payload));
    }
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
