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

## Get billing summary

`GET /api/v1/payment/subscription`

Returns the caller's current plan. Paid plans come from the subscription that
Paddle webhooks record; without an active paid subscription the default tier is
returned.

Response:

```json
{
  "tier": { "id": "6651f2c21f2db72ae60ac456", "name": "Pro", "isDefault": false },
  "billingInterval": "monthly",
  "nextRenewalDate": "2026-08-01T00:00:00.000Z",
  "subscriptionStatus": "active"
}
```

The subscription is written by the webhook, not by checkout, so it can appear a
few seconds after Paddle reports `checkout.completed`. After checkout, landing
redirects to `/billing?checkout=success`, and the web app polls this endpoint
until the purchased tier appears.

## List invoices

`GET /api/v1/payment/invoices`

Returns the caller's 30 most recent Paddle transactions, newest first. Paddle is
the source of truth, so nothing is stored locally. Unfinished checkouts (`draft`
and `ready`) are left out. A caller with no Paddle customer gets an empty list.

Response:

```json
{
  "items": [
    {
      "id": "txn_01h8z9k2m4n6p8q0r1s2t3u4v5",
      "plan": "Pro",
      "amount": "2900",
      "currency": "USD",
      "status": "completed",
      "date": "2026-10-01T00:00:00.000Z",
      "invoiceAvailable": true
    }
  ]
}
```

- `amount` is a string in the currency's lowest unit, so `"2900"` USD is $29.00.
  JPY, KRW, VND, and CLP have no minor unit, so `"1200"` JPY is ¥1,200. It and
  `plan` can be `null`.
- `status` is `billed`, `paid`, `completed`, `past_due`, or `canceled`.
- `503` means Paddle could not be reached or refused the request. It does not
  mean the caller has no invoices.

## Get an invoice PDF link

`GET /api/v1/payment/invoices/:transactionId/pdf`

Returns a link that downloads the invoice PDF. Request it when the user asks for
the file, because the link expires after an hour. Limited to 20 requests per
minute.

```json
{ "url": "https://..." }
```

Returns `404` when the transaction doesn't exist, belongs to another customer, or
has no invoice (`invoiceAvailable` is `false`). Returns `503` when Paddle could
not be reached or refused the request.

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
