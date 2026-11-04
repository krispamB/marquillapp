/**
 * True on devices with a precise pointer (mouse/trackpad). Use it to gate
 * auto-focus: on touch devices focusing a field opens the on-screen keyboard,
 * which shifts and resizes the screen before the user asked to type.
 */
export function hasFinePointer() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;
}
