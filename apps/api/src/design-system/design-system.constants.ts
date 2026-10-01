import { join } from 'node:path';

/**
 * Module constants for Design Systems (document generation spec §10). They
 * change by deploy, never by environment, so a document never renders
 * differently per environment.
 */

/** The one Definition contract the app can consume (§3.3). */
export const SUPPORTED_CONTRACT = 1;

/** What a create request that names no Design System gets (§3.4). */
export const DEFAULT_DESIGN_SYSTEM_ID = 'margin';

/**
 * Google families a definition may declare (§3.6). Read by the seed check and,
 * later, by assembly's font link. Adding a font is a deploy.
 */
export const DESIGN_SYSTEM_FONT_ALLOWLIST: readonly string[] = [
  'Anton',
  'Archivo',
  'Bodoni Moda',
  'Oswald',
  'Inter',
  'Inter Tight',
  'Sora',
  'Manrope',
  'Bricolage Grotesque',
  'Space Mono',
  'Space Grotesk',
  'JetBrains Mono',
];

/**
 * ACTIVE systems hidden from selection (§11.4). Existing pins still resolve.
 * `DEFAULT_DESIGN_SYSTEM_ID` may never appear here.
 */
export const UNLISTED_DESIGN_SYSTEMS: readonly string[] = [];

/**
 * The pinned icon catalog (§4.5): `lucide-static` at an exact version. Upgrading
 * Lucide mints a new id and is handled like a contract change.
 */
export const ICON_CATALOG_ID = 'app-inline-v1';

/** The seed directory. The working directory is always `apps/api`. */
export const DESIGN_SYSTEM_SEED_DIR = join(
  process.cwd(),
  'assets',
  'design-systems',
);

export const DEFINITION_FILE = 'definition.ds.yaml';
export const PREVIEWS_DIR = 'previews';
export const PREVIEW_FILE = /^page-\d{2}\.png$/;
