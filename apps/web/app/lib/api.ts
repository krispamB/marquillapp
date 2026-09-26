// Authenticated browser → backend fetch.
//
// Clerk's `__session` cookie holds a JWT that expires after 60 seconds, so it is
// only as fresh as the last time the client SDK happened to rewrite it (and is
// never refreshed at all for backgrounded tabs) — the cause of the "JWT is
// expired" failures.
//
// `apiFetch` mints a *fresh* token via the in-memory Clerk session (cache-aware:
// only hits the network when the current token has expired) and sends it as a
// Bearer header. It keeps `credentials: "include"` so the `__session` cookie
// still rides along as before — the backend authenticates whether it reads the
// Authorization header or the cookie, with the header providing the always-fresh
// path. No regression versus plain cookie auth; a guaranteed-fresh token on top.
//
// Use this only for backend calls. External URLs (stock photos, presigned
// uploads, raw image downloads) must keep using plain `fetch`.

type ClerkSession = { getToken: () => Promise<string | null> };
type ClerkInstance = { session?: ClerkSession | null };

async function freshToken(): Promise<string | null> {
  const clerk = (globalThis as { Clerk?: ClerkInstance }).Clerk;
  if (!clerk) return null;
  try {
    return (await clerk.session?.getToken()) ?? null;
  } catch {
    return null;
  }
}

export async function apiFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await freshToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers, credentials: "include" });
}
