# Clerk Integration Analysis

> Status: proposal / decision doc. Branch: `feat/clerk-auth-integration`.
> Author: generated for Christopher Pam.

## 1. How authentication works today

### Login (Google only)

- `GoogleStrategy` (`passport-google-oauth20`) handles the OAuth dance via `@nestjs/passport`.
- `AuthService.validateGoogleUser` finds or creates a `User`, keyed on `googleId` with an
  email fallback, assigns the default `Tier`, and enqueues a welcome email.
- `AuthService.login` signs a **self-issued JWT** (`{ email, sub: userId }`, `JWT_SECRET`,
  30-day cookie) and `AuthController` sets it as an `httpOnly` `access_token` cookie on
  `.marquill.com` (prod), plus a **non-httpOnly `user` cookie** holding the serialized user.

### Session validation

- `JwtStrategy` (`passport-jwt`) pulls `access_token` from the cookie, verifies it with
  `JWT_SECRET`, then **loads the Mongo `User` and populates `tier`**.
- `JwtAuthGuard` (`AuthGuard('jwt')`) protects routes; `@GetUser()` injects the full
  Mongoose `User` document onto the request.

### Blast radius

- **8 controllers** use `JwtAuthGuard` + `@GetUser()` (12 route guards): `post`, `auth`,
  `payment`, `feedback`, `workflow`, `users`, `onboarding`, `tier`.
- `SubscriptionAccessGuard` reads `request.user._id` to resolve entitlement — it depends on
  the guard having attached a **local** user with a Mongo `_id`.
- The **worker process** bootstraps an `ApplicationContext` and does no HTTP auth — unaffected.

### What is NOT authentication (leave alone)

- **LinkedIn** is _not_ a login provider today. It is a **connected publishing account**:
  hand-rolled OAuth, AES-256-GCM encrypted tokens in `ConnectedAccount`, avatar refresh, org
  support. See §8 for how LinkedIn-as-login relates to this.

### Key constraints any option must preserve

1. Downstream code expects `request.user` to be the **local Mongo `User`** (with `_id` and a
   populated `tier`), not a raw token payload.
2. `SubscriptionAccessGuard`, feature gating, and `ConnectedAccount.user` references all key off
   the Mongo `_id`. We need a stable mapping from the external identity to that `_id`.
3. The frontend currently reads a `user` cookie and relies on a same-site cookie session.

---

## 2. The mapping problem (applies to every option)

Whatever we adopt, we must map a Clerk identity to the existing `User._id`. Recommended:

- Add `clerkId` alongside (not replacing) `googleId`. Both optional provider IDs use a unique
  partial index restricted to string values; missing and explicit `null` values are not indexed.
- On first authenticated request (or via webhook — see §6), find-or-create the local user by
  `clerkId`, falling back to `email` to **link existing Google users** so nobody loses data.

```ts
// user.schema.ts (additive field; index declared explicitly below the schema)
@Prop()
clerkId?: string;

UserSchema.index(
  { clerkId: 1 },
  {
    name: 'user_clerk_id_unique',
    unique: true,
    partialFilterExpression: { clerkId: { $type: 'string' } },
  },
);
```

This means existing users keep their `_id`, drafts, subscriptions, and connected accounts.

---

## 3. Option A — Full cutover: Clerk-issued tokens, networkless verification _(RECOMMENDED target)_

Clerk becomes the only identity provider. The frontend uses Clerk's components/SDK for sign-in
(Google, email/magic-link, LinkedIn, etc.). The backend stops minting JWTs and instead
**verifies the Clerk session token** on every request.

### Mechanism

- Frontend sends the Clerk session token via the `__session` cookie (same-origin — see §8).
- A new `ClerkAuthGuard` replaces `JwtAuthGuard`. It verifies the token **networklessly** using
  Clerk's `jwtKey` (the JWKS public key, cached) — no per-request call to Clerk's API:

```ts
// clerk-auth.guard.ts (sketch)
import { verifyToken } from '@clerk/backend';

const token = request.cookies?.__session; // same-origin cookie transport
const claims = await verifyToken(token, {
  jwtKey: this.config.getOrThrow('CLERK_JWT_KEY'), // networkless
  authorizedParties: [this.config.get('FRONTEND_URL')], // anti-CSRF / subdomain leakage
});
// claims.sub === Clerk user id
const user = await this.userProvisioning.findOrCreate(claims); // -> local Mongo User
request.user = user; // keeps @GetUser() and SubscriptionAccessGuard working unchanged
```

- `AuthService.login`, the self-issued JWT, `JwtStrategy`, `GoogleStrategy`, and the manual
  Google OAuth controller routes are **deleted**. `passport`, `passport-jwt`,
  `passport-google-oauth20`, and `@nestjs/jwt` can be dropped.

### Advantages

- **Single source of truth** for identity; no two-session drift.
- **Offloads the hard parts**: MFA, social providers, magic links, bot/abuse protection,
  session revocation, password resets, account recovery, email verification — all Clerk's job.
- **Networkless verification** keeps the hot path fast (one cached public key, no API round-trip).
- Removes hand-rolled JWT/cookie/CSRF surface (`JWT_SECRET`, the non-httpOnly `user` cookie,
  manual cookie domain juggling) — net **less security-sensitive code we own**.
- Easy to add providers later with zero backend changes.

### Disadvantages

- **Vendor lock-in** and a new **per-MAU cost** once past the free tier.
- **External dependency / availability**: Clerk outage or JWKS rotation issues affect login
  (mitigated: networkless verify survives brief API outages; tokens are short-lived though).
- **Frontend rewrite** of the sign-in flow and session handling (cookie → Clerk SDK).
- **Migration**: existing 30-day cookies are invalidated at cutover unless we run a transition
  window (see Option B). Need the `clerkId`/email linking from §2 to avoid orphaning users.
- Data residency / privacy review: user PII now lives in Clerk.

---

## 4. Option B — Incremental strangler: dual guard _(RECOMMENDED migration path to reach A)_

Don't flip everything at once. Ship a `ClerkAuthGuard` that **accepts a Clerk token if present,
otherwise falls back to the legacy `access_token` JWT**. Both produce the same `request.user`.

### Mechanism

- One composite guard tries Clerk verification first, then the existing `passport-jwt` path.
- Roll out per-route or globally behind a flag. New logins go through Clerk; existing cookies
  keep working until they expire (≤30 days), then everyone is on Clerk.
- Once legacy JWT traffic hits zero, delete the fallback → you are now at Option A.

### Advantages

- **Zero forced logout**; existing sessions drain naturally.
- De-risks the frontend cutover — can A/B or roll back per route.
- Same end-state as A with a safe path there.

### Disadvantages

- Temporarily **two auth code paths** to maintain and test.
- Slightly more complex guard logic during the window.
- Requires discipline to actually finish the migration and remove the fallback.

---

## 5. Option C — Hybrid façade: Clerk for login, keep minting our own JWT _(NOT recommended)_

Use Clerk only for the credential UI, but after Clerk sign-in, exchange the Clerk token once and
**continue issuing our own `access_token` cookie** as today.

### Advantages

- Minimal change to backend guards and the frontend session model.
- Keeps cookie-based same-site session ergonomics.

### Disadvantages

- **Two session systems** running at once — the worst of both: we still own JWT signing,
  rotation, revocation, and the `JWT_SECRET`, _plus_ now depend on Clerk.
- Session **revocation in Clerk doesn't propagate** to our long-lived cookie → security gap.
- We keep nearly all the code Clerk was supposed to remove. Low payoff for the added dependency.

Only consider this if a hard requirement forbids sending a token on every request.

---

## 6. User provisioning: webhook vs lazy (orthogonal to A/B/C)

- **Lazy (find-or-create on first authenticated request)** — simplest, no webhook infra, always
  consistent because it runs inline. Slight first-request latency. **Recommended to start.**
- **Webhook-driven (`user.created`, `user.updated`, `user.deleted`)** — keeps Mongo eagerly in
  sync (good for the welcome-email enqueue and for soft-deletes), but adds an endpoint,
  signature verification, and eventual-consistency edge cases.

A pragmatic combo: **lazy provisioning now**, add the `user.created` webhook later only to move
the welcome-email enqueue off the request path.

---

## 7. Recommendation

**Adopt Option A (Clerk-issued tokens, networkless verification) as the target architecture, and
get there via Option B (dual-guard strangler).** Provision users **lazily** at first, keyed on a
new partial-unique `clerkId` with email-based linking for existing Google users.

Rationale:

- The custom JWT/cookie/Google-OAuth stack is exactly the kind of undifferentiated, security-
  sensitive code Clerk eliminates, and the blast radius is contained: `@GetUser()` and
  `SubscriptionAccessGuard` keep working as long as the guard still attaches the local Mongo user.
- LinkedIn _publishing_ (the actually-valuable, domain-specific integration) is untouched (§8).
- The strangler path means **no forced logout** and a reversible rollout.

Avoid Option C — it doubles the session surface instead of shrinking it.

---

## 8. Decisions (locked)

| Question                         | Decision                                 | Implication                                                                                                                                                                              |
| -------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sign-in methods**              | Google, Email + magic link, **LinkedIn** | Adds two new login paths beyond today's Google-only. All resolve to one local `User` via `clerkId`/email linking.                                                                        |
| **LinkedIn login vs publishing** | **Keep separate**                        | Clerk's LinkedIn connection provides **identity only** (`openid profile email`). The existing hand-rolled publishing OAuth + `ConnectedAccount` + encrypted-token flow is **unchanged**. |
| **Token transport**              | **`__session` cookie** (same-origin)     | Frontend and API share a domain (already `.marquill.com` in prod). Guard reads the `__session` cookie; keep CSRF in mind for state-changing routes. CORS stays `credentials: true`.      |
| **Replace `user` cookie**        | **Backend `GET /users/me`**              | Drop the non-httpOnly `user` cookie. Frontend loads the local Mongo user (incl. `tier`) from an authenticated `/users/me`; identity (name/avatar/email) can also come from Clerk's SDK.  |

### Consequences of "LinkedIn login, kept separate"

- A user can sign in **with LinkedIn** (identity) yet still have **no posting capability** until
  they run the existing "connect LinkedIn" flow — login ≠ publishing token. The connect-to-publish
  step stays mandatory for every user regardless of how they logged in.
- LinkedIn OAuth therefore happens **twice** for a LinkedIn-login user (once for identity via
  Clerk, once for publishing via our flow). Accepted tradeoff for keeping the publishing path
  untouched and low-risk.
- Future option if the double-authorize UX becomes a complaint: configure Clerk's LinkedIn
  connection with our custom credentials + posting scopes and pull the token via
  `clerkClient.users.getUserOauthAccessToken(userId, 'linkedin_oidc')` — unifies the two without
  re-architecting the org-ACL / `impersonatorUrn` logic, which would still be needed.

### Consequences of the `__session` cookie choice

- Verify with `verifyToken`/`authenticateRequest` reading the `__session` cookie (not just Bearer).
- Set `authorizedParties` to the frontend origin(s) to prevent subdomain cookie leakage.
- Same-site cookie semantics mirror today's `access_token` cookie, so the prod cookie-domain setup
  on `.marquill.com` carries over conceptually.

### Migration sequence (reflecting decisions)

1. Add `clerkId` (partial-unique for string values) to `User`; `UserProvisioningService.findOrCreate(claims)` with
   email linking.
2. Add `@clerk/backend`; `ClerkAuthGuard` verifies the **`__session` cookie** networklessly
   (`jwtKey` + `authorizedParties`), then attaches the local Mongo `User`.
3. Ship as a **dual guard** (Clerk → legacy JWT fallback). Env: `CLERK_PUBLISHABLE_KEY`,
   `CLERK_SECRET_KEY`, `CLERK_JWT_KEY`.
4. In Clerk, enable Google, Email/magic-link, and LinkedIn (identity-only) connections.
5. Add `GET /users/me`; frontend migrates from the `user` cookie to that endpoint + Clerk SDK.
6. Frontend sign-in moves to Clerk; new sessions are Clerk-only.
7. After legacy cookie TTL (≤30 days), remove the JWT fallback, `JwtStrategy`, `GoogleStrategy`,
   `AuthService.login`, the `user` cookie, and unused passport/jwt deps.
8. **Untouched throughout:** the entire LinkedIn _publishing_ flow (`ConnectedAccount`, encryption,
   org ACLs, avatar refresh).

### Production identity-index repair

The original `googleId_1` unique index treats missing values as `null`, which prevents more than
one Clerk-only user from being inserted. Do not fix this by repeatedly deleting the index in
Compass: the old schema can recreate it.

After deploying the partial-index schema, audit production locally using the `MONGO_URI` in
`.env`:

```bash
npm run db:migrate:user-indexes
```

The command is dry-run by default. After reviewing the two explicit create/drop operations, apply
them with:

```bash
npm run db:migrate:user-indexes -- --apply
```

The migration connects with automatic indexing disabled, creates the replacement indexes before
dropping only the known legacy definitions, verifies the final catalog, and is safe to rerun. It
does not rewrite or delete user documents.
