# AI-authored document design systems

Label: wayfinder:map

## Destination

Produce a decision-complete backend specification for replacing fixed carousel templates with AI-authored Document Source constrained by app-owned, versioned Design Systems, including the artifact, workflow, rendering, validation, safety, API, migration, testing, and documentation contracts needed for implementation.

## Notes

- This is a planning map. It resolves decisions and produces detailed backend contract documentation; it does not implement the feature.
- Every session should consult `CONTEXT.md`, `docs/carousel-template-system-design.md`, `docs/artifact-schema-and-library-api-design.md`, `docs/artifact-workflow-prd.md`, and the narrower workflow documents relevant to its question.
- Grilling tickets use the `grilling` and `domain-modeling` skills one question at a time.
- Research uses primary sources and records citations in a repository Markdown document.
- Settled launch boundaries: Design Systems are app-owned; repository YAML seeds versioned MongoDB records; generated HTML/CSS is internal and untrusted; Google Fonts are allowlisted and loaded by Browserless; icons come from an app-owned inline catalog; image assets, frontend implementation, an admin authoring API, user-owned Design Systems, and compatibility with template-based Document Versions are outside scope.
- A Refinement creates a new immutable version. The prior READY version remains current until its replacement reaches READY.
- Provider usage from generation, repair, validation, rendering, and any visual review is metered through the existing workflow credit path.

## Decisions so far

## Not yet specified

- The exact final specification structure and the precise amendments needed in each existing decision document will become clear after the component contracts settle.
- Rollout and operational acceptance thresholds may need to split into separate decisions once the render-validation and visual-review policies are known.

## Out of scope

- Frontend implementation, including a Design System picker or HTML editor.
- Administrative APIs or runtime UI for authoring app-owned Design Systems.
- User-owned or organization-owned Design Systems.
- Image assets, including uploads, stock images, and AI-generated raster artwork.
- Direct client access to or submission of generated Document Source.
- Compatibility or data migration for existing `templateId + slides[]` Document Versions.
- Implementing the feature after the backend specification is complete.
