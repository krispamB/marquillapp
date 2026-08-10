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

**Document Source**:
The complete, self-contained HTML and CSS generated for one Document Version and used to render its PDF.
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
