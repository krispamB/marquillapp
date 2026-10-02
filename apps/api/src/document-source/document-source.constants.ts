/**
 * Module constants for Candidate Source and Document Source (document
 * generation spec §10). They change by deploy, never by environment.
 */

/** The Candidate Source size cap, checked before parsing (§4.4). */
export const CANDIDATE_SOURCE_MAX_BYTES = 256 * 1024;

/** Violations sent to the model: at most this many per `code` (§4.4)... */
export const MODEL_VIOLATIONS_PER_CODE = 3;

/** ...and at most this many in total. */
export const MODEL_VIOLATIONS_TOTAL = 40;
