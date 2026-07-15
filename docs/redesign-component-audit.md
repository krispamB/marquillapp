# Marquill redesign: component audit

This is the component-level follow-up to `redesign-endpoint-gaps.md`. The handoff covered the authenticated Dashboard, Posts, Composer, Billing, and Calendar surfaces. The active routes now use `app/redesign/`; the older dashboard/posts components remain in the repository but are no longer mounted by those routes.

## Active route coverage

| Route | Active implementation | Audit result |
| --- | --- | --- |
| `/dashboard` | `app/redesign/DashboardClient.tsx` | Covered. The shared shell now also exposes Help & feedback. |
| `/posts` | `app/redesign/PostsClient.tsx` | Covered. Status filters, search, scheduling, publish, delete confirmation, and endpoint-backed data are present. |
| `/posts/new`, `/posts/:id/edit` | `app/redesign/ComposerClient.tsx` | Covered. Generation, editing, upload, publish, schedule picker, and LinkedIn preview are present. |
| `/calendar` | `app/redesign/CalendarClient.tsx` | Covered. Month/week views and endpoint-backed drag-to-reschedule are present. |
| `/billing` | `app/redesign/BillingClient.tsx` | Covered with documented payment-provider gaps. |
| `/settings` | `app/redesign/SettingsClient.tsx` | Covered with documented preferences gaps. |

## Legacy components not represented directly in the handoff redesign

| Legacy component | What was omitted or changed | Disposition |
| --- | --- | --- |
| `app/dashboard/BugReportModal.tsx` | The old dashboard mounted a bug/feature modal from the legacy sidebar. | Reimplemented as `app/redesign/FeedbackModal.tsx`, available from the redesigned desktop sidebar and mobile top bar. It keeps the existing `POST /feedback/issues` contract and device report payload. |
| `app/dashboard/Sidebar.tsx` | Legacy navigation, account switcher, mobile drawer, upgrade affordance, and feedback entry were not reused. | Replaced by `app/redesign/Shell.tsx`. Help & feedback and account switching are retained; legacy drawer internals are intentionally not carried over. |
| `app/dashboard/NewPostModal.tsx` | The old modal is a large multi-phase composer with emoji insertion, stock-media search, existing-media handling, and the original natural-language scheduler. | Replaced by the route-based `ComposerClient`. Generation, editing, upload, publishing, scheduling, and preview are covered. Stock search remains disabled because its provider/backend contract is unresolved; natural-language scheduling is replaced by the redesigned calendar picker. |
| `app/dashboard/useNewPostModal.ts` | Modal state machine is not used by the route-based composer. | Orphaned legacy helper; safe cleanup candidate after the old dashboard bundle is removed. |
| `app/posts/PostsClient.tsx` | The old page bundled the legacy sidebar, modal composer, reschedule popover, mobile drawer, and delete modal. | Replaced by `app/redesign/PostsClient.tsx`; old file is not imported by the active `/posts` route. |
| `app/posts/ReschedulePopover.tsx` and `app/posts/naturalDate.ts` | Natural-language date parsing and ghost completion were not part of the new handoff visual. | Replaced by `app/redesign/SchedulePicker.tsx`, which is now used by Composer and Posts. It provides month navigation, disabled past dates, time selection, timezone-safe local values, portal positioning, and future-time validation. |
| `app/posts/ConfirmDeleteModal.tsx` | The first redesign pass deleted directly from the row. | Reimplemented as `app/redesign/DeleteConfirmModal.tsx`, including the published-post warning. |
| `app/dashboard/components.tsx` | Legacy primitives such as `CustomSelect`, old mobile navigation, and old avatar/sidebar helpers are not used by the active workspace routes. | Retained only for legacy component dependencies; cleanup candidate once the old dashboard/post clients are deleted. |
| `app/dashboard/DashboardClient.tsx` | The original dashboard included more legacy-specific interactions and data states than the handoff screen. | Replaced by the redesigned dashboard route. Any feature not listed in the active route coverage or endpoint-gap document needs a product decision before porting. |

## Related active routes

These routes remain active alongside the redesigned workspace:

- `/billing`: plan selection and Paddle checkout now live in the authenticated workspace; the standalone `/pricing` route was removed.
- `/onboarding`: six-step signup/connect flow remains active.
- `/sign-in`, `/sign-up`, `/`: auth and marketing surfaces remain outside the authenticated workspace redesign.
- `app/not-found.tsx`: global fallback surface remains unchanged.

## Remaining follow-up candidates

1. Remove the orphaned legacy dashboard/posts bundle after product sign-off and a production smoke test.
2. Choose a server-side media-search contract before enabling Pexels and Unsplash in the redesigned composer.
3. Add backend contracts for notification preferences, timezone persistence, payment management/receipts/cancellation, and engagement analytics.
4. Revisit natural-language scheduling only if it remains a required product behavior after the calendar picker rollout.
