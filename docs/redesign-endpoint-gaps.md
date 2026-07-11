# Marquill redesign: endpoint and component gaps

This document records the backend coverage reviewed while implementing the redesign from `Marquill landing page redesign-handoff.zip`.

## What was reviewed

- `project/Marquill App.dc.html` was treated as the primary design, per the archive README. It contains desktop and mobile compositions for Dashboard, Posts, New post/Composer, Billing, and Calendar.
- `Sidebar.dc.html` and `TabBar.dc.html` define the shared navigation. Their links are prototype `href="#"` placeholders, so the production implementation maps them to real routes.
- `Marquill Landing.dc.html` is a separate marketing exploration with two hero options, product proof, feature sections, pricing, and a mobile landing page. `Marquill Landing-print-10a86x9.dc.html` is the same design plus print/export helpers. They are not the primary authenticated-app target.
- `Canvas.dc.html` is only the design-canvas wrapper.
- `styles/pulse-tokens.css`, the Pulse design-system README, manifest, generated bundle, provider SVGs, thumbnail, and `uploads/Group 4.png` were reviewed for visual foundations/assets. The Pulse bundle's PR-intelligence demo components are unrelated to Marquill's LinkedIn domain and were not copied into production.

## Implemented endpoint mapping

| Redesign surface | Endpoint(s) used | Coverage |
| --- | --- | --- |
| Dashboard data | `GET /posts?accountConnected=:id&month=:yyyy-mm`, `GET /payment/usage`, `GET /posts/metrics/:accountId` | Implemented. |
| Posts list | `GET /posts?accountConnected=:id&month=:yyyy-mm` | Implemented with local status tabs and search. |
| Edit/save post | `GET /posts/:id`, `PATCH /posts/:id` | Implemented. |
| Generate with Mark | `POST /posts/:accountId/draft`, `GET /posts/:id/status`, `GET /posts/:id` | Implemented with polling. |
| Publish/schedule/delete | `POST /posts/:id/publish`, `POST /posts/:id/schedule`, `DELETE /posts/:id` | Implemented. Calendar drag-and-drop rescheduling uses the schedule endpoint. |
| Media upload | `PUT /posts/:id/media` with `files` form data | Implemented after a draft ID exists. |
| Billing | `GET /tiers/active`, `GET /payment/usage`, `GET /payment/invoices` | Implemented. |
| Connected accounts | `GET /auth/connected-accounts`, `DELETE /auth/connected-accounts/:id` | Implemented in the shared shell/settings route. |

## Missing or mismatched backend coverage

These are real gaps or contract mismatches, not mocked values hidden as working data.

| UI component/state | Gap | Current behavior |
| --- | --- | --- |
| Dashboard “Avg. engagement” tile | No engagement/analytics endpoint exists in the current frontend contract. `GET /posts/metrics/:accountId` only returns post counts by month. | The redesign shows `—` and labels the metric as unavailable. |
| Billing “Manage payment” | No payment-method/portal endpoint is present. | Disabled control with an explicit tooltip. |
| Billing receipt links | The invoice list has no receipt/download URL contract. | Disabled receipt controls. |
| Billing cancel subscription | The product spec mentions cancellation, but no client endpoint is available in this repository. | Not presented as an active action; documented here for backend work. |
| Settings notifications and timezone | No preferences endpoint or persistence model is available. | Controls are visibly unavailable and explain why. |
| Composer Pexels/Unsplash search | The handoff expects provider search buttons. The backend spec says `GET /media/search`, but the current frontend calls the providers directly with `NEXT_PUBLIC_*_ACCESS_KEY` values instead; no `/media/search` implementation is wired here. | Provider buttons are disabled in the new composer until a server-side search contract is chosen. |
| Blank “create draft” | The product spec lists `POST /posts`, but the working frontend contract creates drafts through `POST /posts/:accountId/draft`. | The composer requires a prompt and generation before save/publish. |
| Account connection from Settings | The working frontend starts OAuth from `POST /auth/linkedin`; the design/spec names `POST /auth/linkedin/connect`. | Settings links to the existing onboarding connection flow. |
| Global notification center/search | The handoff shows a notification bell and desktop search field but no notification or global-search endpoint. | Search filters the currently loaded page data; the bell is visual only. |
| Analytics destination | The old navigation contains a disabled Analytics item, but there is no analytics route or endpoint. | It is not added as a fake page in the redesign. |

## API naming differences to reconcile

The repository's working client and the older `marquill.md` product contract do not use identical paths:

- Product notes: `/payments/usage`, `/payments/subscription`, and Paystack checkout/webhooks.
- Working client: `/payment/usage`, `/payment/subscription`, `/payment/invoices`, `/tiers/active`; pricing currently redirects to the configured landing checkout using provider price IDs.
- Product notes: `POST /media/upload`.
- Working client: `PUT /posts/:id/media`.
- Product notes: `POST /auth/linkedin/connect` and `DELETE /auth/linkedin/accounts/:id`.
- Working client: `POST /auth/linkedin` for OAuth URL and `DELETE /auth/connected-accounts/:id` for disconnect.

The redesign follows the working client paths so existing backend integrations remain usable. The API contract should be normalized before adding new server-side features.
