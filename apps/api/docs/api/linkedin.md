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
