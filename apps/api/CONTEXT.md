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
An immutable snapshot of a generated document, including its Document Source and derived PDF.
_Avoid_: Edit, revision

**Current Version**:
The newest `READY` version of an Artifact. A failed generation attempt never replaces it.
_Avoid_: Latest attempt, head

**Refinement**:
A user-requested AI regeneration that appends a new immutable version of an Artifact.
_Avoid_: Edit, fix, patch
