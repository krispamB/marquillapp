# LinkGen

LinkGen turns a user's intent into versioned, publishable LinkedIn content.

## Document generation

**Design System**:
A reusable visual constraint profile that guides AI generation of a document's layout and styling.
_Avoid_: Template, theme

**App-Owned Design System**:
A Design System curated and made available by LinkGen. All Design Systems at launch are app-owned.
_Avoid_: Default template, built-in theme

**Design System Definition**:
The canonical YAML text of a Design System, parsed and validated against a versioned contract before use.
_Avoid_: Prompt fragment, template configuration

**Design System Version**:
An immutable snapshot of a Design System Definition. Each Document Version records the Design System Version that guided its generation.
_Avoid_: Current theme, design revision

**Candidate Source**:
The HTML and CSS a generation attempt produces, before the app has accepted it. It is what the Document Source contract validates; it becomes a Document Source only once it passes and is assembled.
_Avoid_: Draft HTML, raw output

**Document Source**:
The complete, self-contained HTML and CSS of one Document Version, assembled from a validated Candidate Source by adding the app-derived frame stylesheet, font link, and inline icons. Frozen with its version and never re-validated.
_Avoid_: Template output, slide fields

**Document Version**:
An immutable snapshot of a generated document: its Document Source, the Candidate Source it was assembled from, its derived PDF, and the Design System Version it is pinned to. Only its commentary may change after it becomes `READY`; any change to the document itself is a new version.
_Avoid_: Edit, revision

**Attempt**:
A version of an Artifact that has not become `READY`: either `GENERATING`, or `FAILED` and kept as content-less history. An Artifact has at most one `GENERATING` Attempt at a time, and a failed Attempt is never resumed.
_Avoid_: Draft version, pending version

**Current Version**:
The newest `READY` version of an Artifact. An Artifact has none until its first version becomes `READY`, and an Attempt never replaces it.
_Avoid_: Latest attempt, head

**Refinement**:
A user-requested AI regeneration of the Current Version that appends a new immutable version of an Artifact. It carries the Current Version's Design System Version forward unless the user explicitly switches Design System.
_Avoid_: Edit, fix, patch

**Repair**:
A backend-initiated model turn, inside one Attempt, that re-emits a Candidate Source to fix the violations the app found in it. Bounded by a shared budget, never requested by the user, and never creates a version.
_Avoid_: Refinement, retry, revision
