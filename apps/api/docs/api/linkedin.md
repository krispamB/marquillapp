# LinkedIn Connected Accounts API

These endpoints require authentication.

## Fetch organizations

### `GET /api/v1/auth/linkedin/orgs`

Returns the LinkedIn organizations the connected personal account can
administer. The account must be active and have usable publishing access.

If the stored access expiry has passed, or LinkedIn rejects the credential with
`401`, the endpoint returns `409`:

```json
{
  "statusCode": 409,
  "message": "Reconnect your LinkedIn account to fetch organizations.",
  "error": "Conflict"
}
```

The client should direct the user through LinkedIn reconnection before retrying.

## Connect organizations

### `POST /api/v1/auth/linkedin/orgs`

Connects selected organizations after verifying them against the organizations
available to the personal LinkedIn account. It inherits the same `409`
reconnection response when that personal account no longer has usable access.

## Analytics permission

Analytics for a personal account need a second LinkedIn consent, because LinkedIn
issues that permission through a separate app. Organizations do not need it.

`GET /api/v1/auth/connected-accounts` returns `analyticsAccessTokenExpiresAt` on a
personal account that has granted it (the token itself is never returned). The web
app uses it to show the "Analytics is off" state without calling analytics: a
personal account whose value is missing or in the past is off. Organizations are
never off.

### `POST /api/v1/auth/linkedin/analytics`

Returns the LinkedIn authorize URL as `data` (a string). Open it in a popup, as
with `POST /auth/linkedin`; the popup closes itself after LinkedIn redirects to
`GET /api/v1/auth/linkedin/analytics/callback`. Then refetch analytics.

| Status | `code` | When |
| --- | --- | --- |
| `409` | `LINKEDIN_ACCOUNT_NOT_CONNECTED` | No active personal LinkedIn account. Connect it first. |
| `503` | `LINKEDIN_ANALYTICS_NOT_CONFIGURED` | The analytics app is not set up on this environment. |

The callback page shows an error instead of success when the link expired, the
consent was cancelled, or the member who consented is not the connected one.
