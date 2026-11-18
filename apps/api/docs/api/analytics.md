# Analytics API

LinkedIn analytics for a connected account. All endpoints require authentication
(`ClerkAuthGuard`, `UserThrottlerGuard`) and only serve accounts owned by the caller.
Design notes and the LinkedIn calls behind each field are in
[`../linkedin-analytics-design.md`](../linkedin-analytics-design.md).

Every response uses the standard envelope `{ statusCode, message, data }`. The shapes
below are `data`.

## Shared concepts

### `range`

Query parameter `range`: `7d`, `28d` (default) or `90d`. Anything else is a `400`.
A range is whole UTC days and ends **yesterday** (UTC); today is never included,
because LinkedIn's daily figures for the current day are incomplete. The previous
period is the same number of days immediately before it.

### `refresh`

Query parameter `refresh=true` bypasses the cache and refetches from LinkedIn.
It is throttled more tightly than a normal read (see `README.md`). Without it,
responses are served from cache when one exists.

### `access`

Every response carries `access`. Anything other than `ok` is still a `200`, with
the data fields `null` or empty, so the screen can render the matching state.

| Value | Meaning | What the client shows |
| --- | --- | --- |
| `ok` | Data was fetched (some sections may still be listed in `unavailable`). | The data. |
| `reconnect_required` | The account is inactive, its token is missing or expired, or LinkedIn answered `401` for an organization. | Reconnect LinkedIn. |
| `missing_scope` | A personal account has not granted the analytics permission, the grant expired, or LinkedIn answered `401` or `403` with it. | "Turn on analytics": start the grant with [`POST /auth/linkedin/analytics`](linkedin.md#analytics-permission), then refetch. |
| `not_admin` | LinkedIn answered `403` for an organization: the member is no longer an administrator of the page. | Explain; no action in Marquill. |
| `unavailable` | LinkedIn rate-limited us or failed, and there is no cached copy. | Try again later. |

### `Metric`

```ts
type Metric = {
  value: number;           // total over the range
  previous: number | null; // total over the previous period; null when unknown
  changePct: number | null; // (value - previous) / previous * 100, one decimal; null when previous is null or 0
};
```

A metric that does not exist for the account type, or whose LinkedIn call failed,
is `null` (and, when it failed, its key is listed in `unavailable`).

## Errors

| Status | When |
| --- | --- |
| `400` | Unknown `range`, or malformed `connectedAccountId`. |
| `404` | The connected account does not exist or belongs to another user. |
| `429` | Throttled. |

## Overview

### `GET /api/v1/analytics/accounts/:connectedAccountId/overview?range=28d`

```jsonc
{
  "account": {
    "id": "665f…",
    "accountType": "PERSON",          // or "ORGANIZATION"
    "displayName": "Ada Lovelace",
    "avatarUrl": "https://…"          // or null
  },
  "access": "ok",
  "range": {
    "key": "28d",
    "days": 28,
    "start": "2026-10-14",            // inclusive, UTC
    "end": "2026-11-10",              // inclusive, UTC
    "previousStart": "2026-09-16",
    "previousEnd": "2026-10-13"
  },
  "fetchedAt": "2026-11-11T09:12:44.000Z",
  "cached": true,
  "followers": {
    "total": 4821,                    // current follower count; null if unavailable
    "gained": { "value": 96, "previous": 71, "changePct": 35.2 }  // Metric | null
  },
  "metrics": {
    "impressions":       { "value": 18340, "previous": 15102, "changePct": 21.4 },
    "reactions":         { "value": 412, "previous": 377, "changePct": 9.3 },
    "comments":          { "value": 58, "previous": 61, "changePct": -4.9 },
    "reposts":           { "value": 14, "previous": 9, "changePct": 55.6 },
    "engagementRate":    { "value": 2.6, "previous": 3.0, "changePct": -13.3 },
    "membersReached":    { "value": 9120, "previous": 8011, "changePct": 13.8 },
    "uniqueImpressions": null,
    "clicks":            null,
    "pageViews":         null
  },
  "series": [
    {
      "date": "2026-10-14",
      "impressions": 640,
      "reactions": 12,
      "comments": 3,
      "reposts": 0,
      "followersGained": 4,
      "clicks": null,
      "pageViews": null
    }
    // one entry per day in the range, oldest first, never a gap
  ],
  "unavailable": []
}
```

Rules:

- `engagementRate` is a percentage with one decimal:
  `(reactions + comments + reposts [+ clicks for organizations]) / impressions * 100`,
  computed from the summed counts. It is `null` when impressions are `0` or unknown.
  Its `changePct` is the relative change between the two rates.
- Per account type:

  | Key | `PERSON` | `ORGANIZATION` |
  | --- | --- | --- |
  | `impressions`, `reactions`, `comments`, `reposts`, `engagementRate` | yes | yes |
  | `membersReached` | yes | `null` |
  | `uniqueImpressions`, `clicks`, `pageViews` | `null` | yes |

- `series` always has exactly `range.days` entries. A value LinkedIn has not
  published yet (organization follower gains lag two days) or that failed is `null`,
  not `0`. `clicks` and `pageViews` are always `null` for `PERSON`.
- Organization figures are organic only; sponsored activity is excluded.
- `unavailable` lists the keys of sections that failed while others succeeded:
  any metric key, `followers.total`, or `followers.gained`. `engagementRate` is
  `null` and listed whenever one of the counts it needs failed. `uniqueImpressions`
  is `null` and listed when LinkedIn answered without a unique-impressions figure.
- For an organization, `followers.gained.value` sums only the days LinkedIn has
  published so far (usually every day but the last), while `previous` is complete.
- A `401` on any section makes the whole response `reconnect_required` for an
  organization and `missing_scope` for a personal account, because every call uses
  the same token. A mix of successes and `403`s is `ok`.
- When `access` is not `ok`: `followers` is `{ "total": null, "gained": null }`,
  every metric is `null`, `series` is `[]`, and `fetchedAt` is the time of the attempt.

## Top posts

### `GET /api/v1/analytics/accounts/:connectedAccountId/posts?range=28d`

Posts published inside the range, with their **lifetime** figures (LinkedIn has no
per-post time series), sorted by impressions, highest first.

```jsonc
{
  "access": "ok",
  "range": { "key": "28d", "days": 28, "start": "2026-10-14", "end": "2026-11-10", "previousStart": "…", "previousEnd": "…" },
  "fetchedAt": "2026-11-11T09:12:44.000Z",
  "cached": false,
  "coverage": "marquill_posts",       // or "all_posts"
  "truncated": false,
  "posts": [
    {
      "urn": "urn:li:share:7325786486870552578",
      "postId": "6660…",              // Marquill Post id, or null if not published through Marquill
      "text": "First 280 characters of the post, plain text…",
      "publishedAt": "2026-10-20T08:00:00.000Z",
      "url": "https://www.linkedin.com/feed/update/urn:li:share:7325786486870552578/",
      "impressions": 5210,
      "reactions": 133,
      "comments": 21,
      "reposts": null,
      "clicks": null,
      "engagementRate": 3.0
    }
  ]
}
```

Rules:

- `coverage`: an `ORGANIZATION` returns every post on the page (`all_posts`).
  LinkedIn does not let an app list a member's posts, so a `PERSON` returns only
  posts published through Marquill (`marquill_posts`).
- `PERSON` rows have `reposts: null` and `clicks: null`. `ORGANIZATION` rows have both.
- Any count on a row (`impressions`, `reactions`, `comments`, `reposts`, `clicks`)
  is `null` when LinkedIn's call for that post failed. It is never reported as `0`.
  Rows with `null` impressions sort last.
- `engagementRate` follows the overview formula with whatever counts are present;
  `null` when impressions are `0`.
- At most 10 posts for a `PERSON` and 50 for an `ORGANIZATION`; `truncated` is
  `true` when more were published in the range than are returned.
- When `access` is not `ok`, `posts` is `[]`.

## Audience

### `GET /api/v1/analytics/accounts/:connectedAccountId/audience`

Who follows the account. Lifetime, so it takes no `range`.

```jsonc
{
  "access": "ok",
  "supported": true,                  // false for PERSON: LinkedIn has no member demographics
  "fetchedAt": "2026-11-11T09:12:44.000Z",
  "cached": true,
  "totalFollowers": 4821,             // or null
  "facets": [
    {
      "key": "seniority",             // "seniority" | "companySize"
      "label": "Seniority",
      "items": [
        { "label": "Senior", "count": 1620, "share": 33.6 }  // share: % of the facet's total, one decimal
      ]
    }
  ]
}
```

Rules:

- `items` are sorted by `count`, highest first, at most 8 per facet. Items with a
  count of `0` are dropped; a facet with no items is dropped.
- For a `PERSON`: `{ "access": "ok", "supported": false, "facets": [], "totalFollowers": null }`
  with no LinkedIn call, whatever state the account's token is in.
