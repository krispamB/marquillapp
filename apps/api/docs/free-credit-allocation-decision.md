# Free Credit Allocation Decision

> Status: accepted.
> Date: 2026-07-13.
> Decision owner: product and engineering.
> Implements: #143.

## Decision

The Free plan provides a **shared, best-effort allowance of 120 credits per
month**. It does not reserve credits by artifact type and does not guarantee one
POST, one POLL, and one DOCUMENT each month.

All initial and refinement runs draw from the same `credits` usage balance.
Usage resets at the existing Free-plan boundary: the start of each UTC calendar
month. Unused credits do not roll over. A user with credit headroom may begin any
non-research artifact run; the successful run settles its actual usage against
the shared balance. Once usage reaches or exceeds 120 credits, later runs are
blocked until reset. The existing headroom-check behavior may allow the final
successful run to take the balance above 120; no credits are reserved before a
run and failed runs are not settled.

Research is not part of the Free allowance. It is a separate paid-plan
capability, regardless of the number of Free credits remaining.

## Product copy

Approved allowance copy:

> 120 credits per month for AI posts, polls, and documents. Usage varies by what
> you create. Research is available on paid plans.

Short plan-card copy:

> 120 shared AI credits/month

Do not use copy that promises or implies "one post, one poll, and one document
per month." The 120-credit allowance is expected to support a useful mix of
those artifacts, but actual provider usage varies and a shared balance cannot
guarantee that mix.

## Implementation consequences

- Set the Free tier's `limits.credits` to `120`.
- Keep a single period usage row keyed by `credits`; do not add per-artifact
  counters, reservations, or entitlements.
- Expose the 120-credit shared limit and current usage through dashboard usage.
- Keep research capability gating independent of the credit balance and omit
  research from Free tier metadata.
- Preserve the existing UTC-month reset, no-rollover, headroom check, and
  success-only settlement semantics.

## Rationale

The shared allowance matches the existing cost-backed meter and keeps the Free
plan easy to explain. Guaranteeing one artifact of each type would require
reservation or entitlement state, create stranded allocations when a user wants
a different mix, and add enforcement complexity without changing the intended
provider-cost exposure.
