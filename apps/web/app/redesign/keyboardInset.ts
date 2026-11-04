/** Fields that bring up the on-screen keyboard when focused. */
const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "range", "file", "button", "submit", "reset", "color", "image", "hidden"]);

export function opensKeyboard(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (element instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(element.type) && !element.readOnly && !element.disabled;
  return element instanceof HTMLElement && element.isContentEditable;
}

/**
 * How much of the layout viewport the keyboard covers, in CSS px. iOS Safari
 * overlays the keyboard and shrinks only the visual viewport, so this is the
 * gap between the layout viewport's bottom and the visual viewport's bottom.
 * Browsers that resize the layout instead report 0.
 */
export function keyboardInset(layoutHeight: number, viewport: { height: number; offsetTop: number }): number {
  return Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop));
}

/**
 * Whether the keyboard is up: a text field has focus and the viewport has
 * either been overlaid (iOS) or shrunk well below its tallest height seen
 * (Android, which resizes the layout). A hardware keyboard changes neither.
 */
export function isKeyboardOpen(fieldFocused: boolean, inset: number, viewportHeight: number, tallestViewport: number): boolean {
  if (!fieldFocused) return false;
  return inset > 60 || viewportHeight < tallestViewport - 120;
}
