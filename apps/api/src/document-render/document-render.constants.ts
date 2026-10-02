/**
 * Module constants for the render session and the judge (document generation
 * spec §5). They change by deploy, never by environment, so a document never
 * renders or judges differently per environment.
 */

/**
 * One deadline for the whole session (§5.1): connect, load, probe, font pass,
 * cover and print. A 2-4 page document takes 13-17 s on Browserless (§5.3).
 */
export const RENDER_SESSION_DEADLINE_MS = 60_000;

/**
 * One Browserless unit of session time. A session is billed whole units,
 * at least one (the same rule as the REST render's
 * `browserlessUnitsForDuration`).
 */
export const BROWSERLESS_UNIT_MS = 30_000;

/**
 * Browserless closes a session on its own after the deadline plus this much,
 * so a session the app lost track of stops spending units.
 */
export const BROWSERLESS_SESSION_GRACE_MS = 10_000;

/**
 * Tolerance, in px, for every geometry rule. Blink rounds a font's ascent and
 * descent separately, so a line box sits up to 1px from where half-leading
 * arithmetic puts it (#137 measured 0.86px). A finding within it is rounding.
 */
export const RENDER_TOLERANCE_PX = 1;

/** Share of the smaller line box two lines must cover before text overlaps. */
export const RENDER_OVERLAP_SHARE = 0.25;

/** Characters of an element's text quoted in a finding's locator. */
export const RENDER_SNIPPET_LENGTH = 32;
