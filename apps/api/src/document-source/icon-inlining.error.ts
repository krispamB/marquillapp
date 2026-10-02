/**
 * An icon placeholder that assembly could not fill (§4.5). Terminal, never
 * silent: an empty `<svg>` is an invisible hole in a published PDF. The
 * Candidate Source already passed `icons.allowed`, so a replay would fail the
 * same way; the step alerts with `icon.inline_failed`.
 *
 * Kept in its own leaf module so a workflow step can `instanceof`-check it
 * without loading parse5.
 */
export class IconInliningError extends Error {
  readonly alertTag = 'icon.inline_failed';

  constructor(message: string) {
    super(message);
    this.name = 'IconInliningError';
  }
}
