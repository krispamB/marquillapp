# Marquill

AI-powered LinkedIn content platform for creators. Generates posts from YouTube research, schedules publishing, and manages multi-account LinkedIn workflows with a mobile-first UX.

## Tech Stack
- Frontend: Next.js + Tailwind CSS
- Backend: NestJS + MongoDB + Redis + BullMQ
- Payments: Paystack

## V1 Scope (Key Features)
- Auth: Google OAuth, LinkedIn OAuth, multi-account support, secure token storage/refresh, account disconnect.
- Post lifecycle: create drafts (quick/insight), edit, auto-save, publish now, schedule, delete.
- Media: Pexels/Unsplash search, device uploads, LinkedIn image URN handling with CDN URL refresh.
- Scheduling: timezone-aware scheduling, calendar view, reschedule/cancel, BullMQ worker.
- Payments: tiered subscriptions, Paystack checkout/webhooks, usage limits and tracking.

## Core Data Models
- Users, LinkedInAccounts, Posts, Subscriptions, UsageMetrics.

## API Modules
- Auth, Posts, Media, Payments (REST endpoints per module).

## External Integrations
- Google OAuth, LinkedIn API, YouTube Data API, OpenRouter, Pexels, Unsplash, Paystack.

## Security & Ops
- Encrypted tokens, JWT auth, rate limiting, CORS whitelist, audit logs, metrics, job retries.

## Frontend Pages
- Landing, Dashboard, Posts list, New/Edit post, Calendar, Settings, Billing.

## Success Metrics
- Conversion rate, MRR, churn, post success rate, AI latency.
