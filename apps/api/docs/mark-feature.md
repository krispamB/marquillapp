# Mark — AI Content Assistant for Marquill

## Overview

Mark is Marquill's built-in AI content assistant. It allows users to generate LinkedIn content artifacts through a conversational interface. Every session with Mark ends with a concrete, usable artifact. Mark is not a general-purpose chatbot — it is purpose-built for LinkedIn content creation.

---

## Goals

- Reduce time-to-draft for LinkedIn content
- Give users a structured creative workspace inside Marquill
- Make document generation (a known pain point) fast and accessible
- Extend Marquill's existing post pipeline with a richer artifact layer

---

## Entry Point

Mark is accessible via a dedicated section in the Marquill sidebar or navigation.

On open, the user sees:

- A free-text input field ("Tell Mark what you want to create")
- Four artifact type shortcuts (optional selection):
  - ✍️ Post
  - 📊 Poll
  - 📄 Document
  - 🔄 Post → Document

The user can either pick a type explicitly or type freely. If they type freely, Mark infers the artifact type from the message and proceeds to generation immediately.

---

## Artifact Types

### 1. Text Post
A LinkedIn-ready written post. Mark generates based on the user's prompt — topic, tone, and format are inferred unless specified.

**Output:** Formatted LinkedIn post text

---

### 2. Poll
A LinkedIn poll with a question and 2–4 options. Mark generates the content only — LinkedIn's poll constraints (2–4 options, 1–2 week duration) are enforced at the UI level before publishing.

**Output:** Poll question + options (content only, not published directly)

---

### 3. Document (PDF)
A designed document generated from a user prompt. Before generation, the user selects one of two formats:

- **One-pager** — A single-page thought leadership or summary document
- **Carousel** — A multi-slide document where each key point occupies its own slide (optimized for LinkedIn document posts)

Format selection happens via a simple picker before generation — not a conversation.

**Output:** PDF file

> Branding customization (colors, fonts, logo) is planned post-MVP.

---

### 4. Post → Document
The user provides an existing LinkedIn post (typed or selected from their Marquill library). Mark converts it into a structured document.

Same format picker applies: **One-pager** or **Carousel**.

This tool directly addresses a documented user pain point — visualizing written content as a designed document without starting from scratch.

**Output:** PDF file

---

## Generation Behavior

Mark generates immediately on receiving a prompt. There is no multi-step confirmation loop before the first output.

**Rationale:** Confirmation loops increase token cost and add friction. The generate-first approach is validated by the existing Vercel AI SDK prototype and aligns with how users expect AI tools to behave.

If Mark infers the wrong artifact type, the user can correct it via one follow-up message. Mark regenerates once based on the correction. After that, refinement moves to the artifact editor.

---

## Refinement Flow

Mark creates. The editor refines. These are distinct responsibilities and must not overlap.

### After Generation

| Artifact | Chat Refinement | Editor | Actions |
|---|---|---|---|
| Text Post | One follow-up regeneration cycle | ✅ Full inline editing | Promote, Download, Regenerate |
| Poll | One follow-up regeneration cycle | ✅ Form-based (question + options, duration) | Promote, Regenerate |
| Document (One-pager / Carousel) | One follow-up regeneration cycle | ❌ None | Promote, Download, Regenerate |
| Post → Document | One follow-up regeneration cycle | ❌ None | Promote, Download, Regenerate |

**One follow-up regeneration cycle applies to all artifact types.** If Mark's first output misses the mark structurally, the user can send one corrective message and Mark regenerates. After that, refinement moves to the editor (where available) or the user regenerates from scratch.

**Documents are not editable in the artifact view.** Partial text edits without layout control produce worse output. The correct action when a document misses is to regenerate with a refined prompt. Document artifact CTAs are **Promote**, **Download**, and **Regenerate** — no inline editor entry point.

### Text Post Editor — Field Breakdown
- Inline text editing
- Tone selector (Professional, Casual, Bold — dropdown or tag)
- Length target (word count or trim/expand control)
- Hashtag manager (add, remove, reorder)
- Hook field (isolated first-line editor — the most critical part of a LinkedIn post)

### Poll Editor — Field Breakdown
- Question text field
- Option fields (2–4, LinkedIn limit enforced at UI level)
- Duration selector (1 or 2 weeks)

---

## Artifact Description Field

Every generated artifact includes an auto-generated description. This is used to make the `/artifacts` library navigable.

**Format:**
```
[Artifact type] — [topic summary], [tone], [word/slide count]
```

**Example:**
```
LinkedIn post — product launch announcement, professional tone, 180 words
Poll — best productivity tools for founders, 4 options
Carousel — 5 lessons from building in public, 6 slides
```

The user can rename or edit this description at any time.

---

## Artifact Storage — `/artifacts`

All Mark-generated content is stored in a dedicated `/artifacts` section in Marquill.

- Artifacts are separate from posts by default
- `/artifacts` acts as a creative workspace / draft library
- Users can browse, preview, rename, and delete artifacts

---

## Promoting an Artifact to the Post Pipeline

All artifact types can be promoted to the Marquill post pipeline via a **Promote** action. Promoting opens the existing Marquill PostDraft composer — the user sees a blank LinkedIn post and the artifact is attached to it. The composer can also be opened independently (without an artifact).

**Flow:**
```
Artifact → [Promote] → PostDraft Composer (blank post + artifact attached) → [Schedule] or [Post Now]
```

### What "attached" means per artifact type

| Artifact | Behavior in Composer |
|---|---|
| Text Post | Generated text auto-populates the post body. User can add images. |
| Poll | Poll question and options transfer into LinkedIn's poll fields. |
| Document (One-pager / Carousel) | PDF is attached to the post. Mark generates suggested commentary that pre-fills the post body. User can edit the commentary. |
| Post → Document | Same as Document above. |

One artifact per post. The backend handles the LinkedIn API differences between post types (text, poll, document) — the composer surfaces the appropriate fields for the attached artifact type.

- **Schedule / Post Now** completes the publishing flow via the existing Marquill pipeline
- **Preview** renders a replica of how the post will appear on LinkedIn (existing Marquill feature)

> Consider revisiting the "Promote" label in UI copy. Alternatives: "Send to Scheduler", "Use this post".

---

## Technical Notes

- **LLM Layer:** Vercel AI SDK (validated via prototype)
- **Streaming:** Responses stream to the UI as they generate
- **PDF Generation:** LLM generates freeform HTML → Puppeteer converts to PDF server-side → HTML is discarded (ephemeral, not stored)
- **PDF Storage:** Converted PDF uploaded to object storage bucket (e.g. S3 or equivalent). Bucket URL stored in MongoDB per artifact
- **On Regenerate:** New HTML generated → converted → overwrites existing PDF in bucket → MongoDB URL reference updated
- **On Download:** Served directly from bucket via signed URL
- **LinkedIn Document Post:** PDF pulled directly from bucket URL — no conversion step at publish time
- **Artifact Metadata (MongoDB):** type, description, userId, createdAt, status (draft | promoted), bucketUrl (PDF artifacts only)
- **Commentary Generation:** Suggested post commentary is generated alongside the document artifact (at generation time, not promote time). It is stored with the artifact and pre-fills the post body when the artifact is promoted.
- **Token Cost:** Minimized by generate-first design and capping chat refinement to one cycle

---

## Out of Scope (MVP)

- Image generation
- Branding customization (colors, fonts, logo on documents)
- Multi-turn conversation before generation
- Artifact sharing or collaboration
- AI-suggested topics or content calendar integration

---

## Success Metrics

- Artifact generation rate per active user
- Post → Document tool usage (proxy for pain point resolution)
- Promote-to-schedule conversion rate (artifact → published post)
- Regeneration rate (proxy for first-output quality)
