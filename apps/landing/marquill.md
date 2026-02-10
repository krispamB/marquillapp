# **Marquill PRD – AI-Powered LinkedIn Content Platform**

## **Product Overview**

**Marquill** is a web-based content creation tool for LinkedIn creators that uses AI to generate posts from YouTube research, handles scheduling, and automates publishing. Mobile-optimized for on-the-go content management.

**Tech Stack:**

* **Frontend:** Next.js \+ TailwindCSS  
* **Backend:** NestJS \+ MongoDB \+ Redis \+ BullMQ  
* **Payments:** Paystack

---

## **V1 Feature Scope**

### **1\. Authentication & Account Management**

#### **Auth Flows**

* Sign In / Sign Up with Google (OAuth 2.0)  
* Connect LinkedIn Account (OAuth 2.0)  
* Get Connected Account(s) details

**Key Behaviors:**

* Users can connect multiple LinkedIn accounts (personal \+ company pages)  
* OAuth tokens stored securely (encrypted in MongoDB)  
* Automatic token refresh  
* Logout \+ disconnect account options

**Edge Cases:**

* LinkedIn token expiry → prompt reconnection  
* User revokes access externally → graceful error handling  
* Multiple Google accounts → clear account switcher

---

### **2\. Post Management**

#### **2.1 Create Post Draft**

**Two Post Types:**

1. **Quick Post** – No Research from youtube Videos (150–300 words)  
2. **Insight Post** – Full research included (150–300 words)

**Creation Flow:**

1. User selects post type  
2. Inputs topic/prompt  
3. AI generates draft using YouTube context  
4. User reviews/edits in rich editor(Not reach text because linked in does not support it, just a text with /n)  
5. Saves as draft (per connected LinkedIn account)

---

#### **2.2 Get Created Posts**

**Filters:**

* By LinkedIn account  
* By status (draft, scheduled, published)  
* Date range  
* Search by content keywords

**Response:**

* Paginated list (10–20 posts per page)  
* Sorted by `updatedAt` (most recent first)

---

#### **2.3 Edit Post**

* Update content, images, schedule time  
* Auto-save drafts every 30 seconds

---

#### **2.4 Publish Post**

**Immediate Publish:**

1. Validate content (LinkedIn limits: max 3000 chars)  
2. Upload images to LinkedIn CDN  
3. Call LinkedIn Share API  
4. Update post status to `published`  
5. Log publish timestamp

**Error Handling:**

* API rate limits → queue retry (BullMQ)  
* Invalid token → prompt reconnection  
* Network failure → store in retry queue

---

#### **2.5 Schedule Post Publishing**

**Scheduling Logic:**

* User selects date/time (in their timezone 2026-02-05T15:47:00+01:00)  
* Store as `scheduledAt` (UTC in DB)  
* BullMQ job processes scheduled posts  
* Publishes via LinkedIn API  
* Updates status to `published`

**User Features:**

* Calendar view of scheduled posts  
* Reschedule or cancel  
* Timezone display (user's local time)

---

#### **2.6 Image Integration**

**Pexels/Unsplash Integration:**

* Search stock photos by keyword  
* Preview \+ select images  
* Store image URLs or download to S3/Cloudinary

**Upload from Device:**

* Accept JPEG, PNG (max 10MB)  
* Compress/resize for LinkedIn specs (1200x627px recommended)  
* Attach to post draft

**Image Management:**

* URN-Based Asset Storage: After a successful image upload, store only the unique Image URN (e.g., urn:li:image:12345) in your database. Do not rely on static URLs as they are not provided at upload.  
* On-Demand Link Fetching: Implement a "Just-in-Time" backend request to the GET /images/{urn} endpoint whenever a preview is needed. This retrieves the downloadUrl, which is a direct link to the image on LinkedIn's CDN.  
* Expiration Management: Handle the downloadUrlExpiresAt timestamp. The link is temporary; ensure your system refreshes it if the user views the preview after the link has expired.  
* Secure Proxy Handshake: All API calls to LinkedIn must be made from your backend server to keep your OAuth 2.0 access token hidden from the client-side browser.  
* Dynamic DOM Injection: Your frontend should receive the downloadUrl and dynamically update the src attribute of a dedicated \<img\> tag in the "Assigned Section" of your UI to display the preview.  
* Asset Lifecycle Validation: Before displaying, verify the asset status is AVAILABLE. If it is still in PROCESSING, the preview should display a loading state or placeholder until the CDN link is fully generated.

---

#### **2.7 Delete Post**

* Can delete published posts (delete from server and )

---

### **3\. Payment & Tier System**

#### **Tier Structure**

| Feature | Free | Starter | Creator | Pro Writers |
| ----- | ----- | ----- | ----- | ----- |
| **Price** | $0 | $9/mo | $29/mo | $79/mo |
| **LinkedIn Accounts** | 1 | 1 | 2 | 10 |
| **AI Posts/Month** | 5 | 30 | 100 | Unlimited |
| **Scheduled Posts** | 3 queued | 10 queued | 50 queued | Unlimited |
| **Post History** | 30 days | 90 days | 1 year | Unlimited |
| **YouTube Research** | 1 video/post | 3 videos/post | 5 videos/post | 10 videos/post |
| **Analytics (V2)** | ❌ | Basic | Advanced | Custom Reports |

#### **Paystack Integration**

**Payment Flows:**

1. **Subscription Signup**

   * User selects tier  
   * Redirects to Paystack checkout  
   * Webhook confirms payment → activate tier  
   * Store subscription in DB (`userId`, `tier`, `expiresAt`)  
2. **Recurring Billing**

   * Paystack auto-charges monthly  
   * Webhook updates subscription status  
   * Email notification before renewal  
3. **Upgrade/Downgrade**

   * Prorated charges via Paystack API  
   * Immediate tier change  
4. **Failed Payment**

   * Grace period (3 days)  
   * Downgrade to free tier  
   * Email alerts

**Subscription Data Model:**

* `userId`  
* `tier` (free | starter | creator | pro)  
* `paystackSubscriptionCode`  
* `expiresAt`  
* `status` (active | cancelled | expired)

**Usage Tracking:**

* Increment counters on each action (AI generation, post publish)  
* Check limits before allowing actions  
* Display usage dashboard (e.g., "5/30 posts used this month")

---

## **Database Schema Overview**

### **Collections**

#### **Users**

* `_id`  
* `email`  
* `googleId`  
* `name`  
* `avatar`  
* `createdAt`, `updatedAt`

#### **LinkedInAccounts**

* `_id`  
* `userId` (ref to Users)  
* `linkedinId`  
* `accessToken` (encrypted)  
* `refreshToken` (encrypted)  
* `expiresAt`  
* `profileData` (name, headline, profileUrl)  
* `accountType` (personal | company)  
* `createdAt`, `updatedAt`

#### **Posts**

* `_id`  
* `userId`  
* `linkedinAccountId`  
* `postType` (quick | insight)  
* `content`  
* `images[]`  
* `status` (draft | scheduled | published)  
* `scheduledAt`  
* `publishedAt`  
* `youtubeContext` (videoIds, transcripts)  
* `aiMetadata` (model, prompt, tokens used)  
* `createdAt`, `updatedAt`, `deletedAt`

#### **Subscriptions**

* `_id`  
* `userId`  
* `tier`  
* `paystackSubscriptionCode`  
* `expiresAt`  
* `status`  
* `createdAt`, `updatedAt`

#### **UsageMetrics**

* `_id`  
* `userId`  
* `month` (YYYY-MM)  
* `postsGenerated`  
* `postsPublished`  
* `scheduledPosts`  
* `storageUsedMB`

---

## **API Structure**

### **Auth Module**

* `POST /auth/google` – Sign in with Google  
* `POST /auth/linkedin/connect` – Connect LinkedIn  
* `GET /auth/linkedin/accounts` – Get connected accounts  
* `DELETE /auth/linkedin/accounts/:id` – Disconnect account

### **Posts Module**

* `POST /posts` – Create draft  
* `GET /posts` – List posts (with filters)  
* `GET /posts/:id` – Get single post  
* `PATCH /posts/:id` – Edit post  
* `POST /posts/:id/publish` – Publish immediately  
* `POST /posts/:id/schedule` – Schedule publish  
* `DELETE /posts/:id` – Delete post

### **Media Module**

* `GET /media/search` – Search Pexels/Unsplash  
* `POST /media/upload` – Upload image

### **Payments Module**

* `POST /payments/checkout` – Create Paystack session  
* `POST /payments/webhook` – Handle Paystack events  
* `GET /payments/subscription` – Get current subscription  
* `POST /payments/cancel` – Cancel subscription  
* `GET /payments/usage` – Get usage metrics

---

## **BullMQ Job Queues**

### **Queues**

1. **post-publish** (scheduled publishing)

   * Job data: `{ postId, linkedinAccountId }`  
   * Scheduled at: `scheduledAt` timestamp  
   * Retry: 3 attempts with exponential backoff  
   * On complete: Update post status to `published`  
2. **ai-generation** (async content generation)

   * Job data: `{ postId, prompt, youtubeVideos[] }`  
   * Priority: high for paid users  
   * Timeout: 60 seconds  
   * On complete: Update post with generated content  
3. **linkedin-sync** (refresh token, sync profile data)

   * Runs: Daily cron  
   * Job data: `{ linkedinAccountId }`  
   * Retry: 2 attempts  
4. **usage-reset** (monthly usage counter reset)

   * Runs: 1st of each month  
   * Resets: `postsGenerated`, `scheduledPosts` counters

---

## **Frontend Pages & Components**

### **Pages**

1. **/ (Landing Page)**

   * Hero section  
   * Features overview  
   * Pricing table  
   * CTA: Sign up with Google  
2. **/dashboard**

   * Overview stats (posts this month, usage %)  
   * Quick actions (new post, schedule)  
   * Recent drafts list  
   * Scheduled posts timeline  
3. **/posts**

   * Filterable post list (tabs: drafts, scheduled, published)  
   * Search bar  
   * Pagination  
4. **/posts/new**

   * Post type selector (quick | insight)  
   * AI prompt input  
   * YouTube link(s) input  
   * Rich text editor  
   * Image picker (Pexels/Unsplash/Upload)  
   * Save draft / Publish / Schedule buttons  
5. **/posts/:id/edit**

   * Same as /posts/new but pre-filled  
   * Re-generate with AI option  
6. **/calendar**

   * Month/week view  
   * Drag-and-drop rescheduling  
   * Click to edit post  
7. **/settings**

   * Connected LinkedIn accounts  
   * Billing & subscription  
   * Usage metrics  
   * Preferences (timezone, notifications)  
8. **/billing**

   * Current plan  
   * Upgrade/downgrade options  
   * Payment history  
   * Cancel subscription

---

### **Key Components**

**Reusable UI:**

* `PostCard` – Display post with actions (edit, delete, publish)  
* `RichTextEditor` – Markdown editor with preview  
* `ImagePicker` – Modal for Pexels/Unsplash search \+ upload  
* `SchedulePicker` – Date/time selector with timezone  
* `UsageMeter` – Progress bar showing tier limits  
* `TierComparisonTable` – Pricing table with feature checkmarks  
* `LinkedInAccountCard` – Display connected account with reconnect option

**Layouts:**

* `AuthLayout` – Centered form for login/signup  
* `DashboardLayout` – Sidebar \+ top nav (responsive)  
* `EditorLayout` – Fullscreen editor with save bar

---

## **Responsive Design Breakpoints**

**Mobile-First Approach:**

* **Mobile:** \< 768px (1 column, bottom nav)  
* **Tablet:** 768px – 1024px (2 columns, side nav)  
* **Desktop:** \> 1024px (3 columns, full sidebar)

**Mobile Optimizations:**

* Bottom navigation bar (Home, Posts, Calendar, Settings)  
* Swipeable post cards  
* Collapsible filters/search  
* Sticky "New Post" FAB (floating action button)  
* Offline draft saving (localStorage sync)

---

## **Redis Caching Strategy**

**Cache Keys:**

* `user:{userId}:subscription` – User tier \+ limits (TTL: 1 hour)  
* `user:{userId}:usage:{month}` – Current month usage (TTL: 24 hours)  
* `linkedin:{accountId}:profile` – LinkedIn profile data (TTL: 1 day)  
* `posts:{userId}:drafts` – List of draft posts (invalidate on create/edit)

**Session Storage:**

* Store user session in Redis (JWT alternative)  
* Key: `session:{sessionId}`, Value: `{ userId, tier, accounts[] }`

---

## **External Integrations**

### **Required APIs**

1. **Google OAuth 2.0** – Authentication  
2. **LinkedIn API** – OAuth \+ Publishing  
3. **YouTube Data API v3** – Video search \+ transcripts  
4. **OpenRouter API** – Content generation  
5. **Pexels API** – Stock photos  
6. **Unsplash API** – Stock photos  
7. **Paystack API** – Payments \+ subscriptions

### **Webhooks to Handle**

* Paystack: `subscription.create`, `subscription.disable`, `charge.success`

---

## **Security Considerations**

**Authentication:**

* Google OAuth tokens stored securely  
* LinkedIn tokens encrypted at rest (AES-256)  
* JWT for API authentication (stored in httpOnly cookies)

**Authorization:**

* Users can only access their own posts/accounts  
* Tier enforcement on every API call  
* Rate limiting (Redis-based)

**Data Privacy:**

* GDPR-compliant data export  
* User deletion → cascade delete posts/subscriptions  
* No PII in logs

**API Security:**

* CORS whitelist (Next.js domain only)  
* Rate limiting: 100 req/min per user  
* Input validation (class-validator in NestJS)  
* SQL injection protection (Mongoose ODM)

---

## **Monitoring & Logging**

**Metrics to Track:**

* API response times (per endpoint)  
* BullMQ job success/failure rates  
* LinkedIn API quota usage  
* AI generation costs (per tier)  
* User retention (monthly active users)

**Logging:**

* Structured logs (JSON format)  
* Error tracking (Sentry or similar)  
* Audit logs for payments

---

## **Future Features (V2+)**

### **Planned for Next Release**

1. **AI Customization**

   * Tone presets (professional, casual, storytelling)  
   * Custom writing style (train on user's past posts)  
   * Hashtag suggestions  
2. **Analytics Dashboard**

   * Post performance (views, likes, comments, shares)  
   * Engagement trends  
   * Best time to post  
3. **Content Library**

   * Save snippets/templates  
   * Reusable intro/outro hooks  
   * Tag organization  
4. **Collaboration**

   * Team accounts (multiple users, one LinkedIn)  
   * Approval workflows  
   * Content calendar sharing  
5. **Multi-Platform**

   * Twitter/X integration  
   * Instagram (carousel posts)

---

## **Open Questions**

1. **AI Tone Presets:** Should this be in V1 or V2? (Recommend: Early V2)  
2. **LinkedIn Limits:** Handling 25 posts/day per account? (Warn user at 20\)  
3. **Offline Mode:** Should drafts work fully offline? (localStorage \+ sync on reconnect)  
4. **Team Features:** Priority for V2? (Wait for user feedback)  
5. **Content Approval:** Do Pro users need multi-step approval flows? (V2 feature)

---

## **Success Metrics (KPIs)**

**User Acquisition:**

* Sign-ups per week  
* Free → Paid conversion rate (target: 5%)

**Engagement:**

* Posts created per user per month  
* % of scheduled posts that publish successfully  
* Average session duration

**Revenue:**

* MRR (Monthly Recurring Revenue)  
* Churn rate (target: \< 5%)  
* Average revenue per user (ARPU)

**Technical:**

* API uptime (target: 99.9%)  
* LinkedIn publish success rate (target: 98%)  
* AI generation latency (target: \< 10s)

