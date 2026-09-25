# Payment API

All payment routes are prefixed with `/api/v1/payment` and require an
authenticated Clerk session, except for Paddle webhook routes.

## Create an overlay checkout transaction

`POST /api/v1/payment/checkout`

Creates a Paddle transaction for an active tier price. The server derives the
user ID and name from the authenticated user; clients must not send identity
data.

Request:

```json
{
  "priceId": "pri_01gm81eqze2vmmvhpjg13bfeqg"
}
```

Response:

```json
{
  "transactionId": "txn_01h0j589qt1nee24210teqtz57",
  "tier": {
    "id": "6651f2c21f2db72ae60ac123",
    "name": "Pro"
  },
  "billingInterval": "monthly"
}
```

Open the Paddle overlay on the frontend using the returned transaction ID:

```ts
Paddle.Checkout.open({ transactionId: response.transactionId });
```

The server stores the authenticated user's ID and name as transaction custom
data so webhook processing can safely associate the resulting subscription with
the user.

## Get dashboard usage

`GET /api/v1/payment/usage`

Returns plan limits and consumption for the caller's active billing cycle. It
also reports how many artifacts of each type were created during that same
`[billingCycle.start, billingCycle.end)` period. Artifact counts include every
created record, including failed generations and artifacts that were later
soft-deleted.

Response:

```json
{
  "statusCode": 200,
  "message": "Usage summary fetched successfully",
  "data": {
    "tier": { "id": "6651f2c21f2db72ae60ac123", "name": "Starter" },
    "billingCycle": {
      "start": "2026-07-01T00:00:00.000Z",
      "end": "2026-08-01T00:00:00.000Z",
      "source": "default"
    },
    "usage": {
      "connected_accounts": { "used": 1, "limit": 1, "remaining": 0 },
      "scheduled_posts": { "used": 2, "limit": 3, "remaining": 1 },
      "credits": { "used": 400, "limit": 2000, "remaining": 1600 }
    },
    "artifactsCreated": {
      "posts": 8,
      "polls": 2,
      "documents": 1
    }
  }
}
```

Artifact count keys are always present and use `0` when the cycle contains no
artifact of that type.
