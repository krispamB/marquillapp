import type { ConnectedAccount, DashboardPost, UserProfile } from "../lib/types";

export type WorkspaceUser = UserProfile;

export type WorkspacePage = "dashboard" | "artifacts" | "posts" | "calendar" | "billing" | "settings";

export function getInitials(name: string, email = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return (parts[0] ?? email).slice(0, 2).toUpperCase();
}

export function getAccountInitials(account?: ConnectedAccount) {
  return getInitials(
    account?.displayName ?? account?.profile?.localizedFirstName ?? "",
    account?.vanityName,
  );
}

export function getFirstName(name: string) {
  return name.trim().split(/\s+/).filter(Boolean)[0] ?? "there";
}

export function getPostTitle(content?: string) {
  const line = content
    ?.split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  return line || "Untitled post";
}

export function normalizeStatus(status?: string) {
  const value = String(status ?? "").toUpperCase();
  if (value === "SCHEDULED") return "SCHEDULED" as const;
  if (value === "PUBLISHED") return "PUBLISHED" as const;
  return "DRAFT" as const;
}

export function parseDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatRelativeDate(value?: string) {
  const date = parseDate(value);
  if (!date) return "Recently";
  const diff = Date.now() - date.getTime();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  if (diff < hour) return `${Math.max(1, Math.floor(diff / 60000))}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < day * 2) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatScheduledDate(value?: string) {
  const date = parseDate(value);
  if (!date) return "No schedule set";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function toYearMonth(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function titleCase(value: string) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

export function isPost(value: unknown): value is DashboardPost {
  return Boolean(value && typeof value === "object" && "_id" in value);
}
