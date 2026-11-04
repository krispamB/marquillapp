"use client";

import { useEffect } from "react";
import { isKeyboardOpen, keyboardInset, opensKeyboard } from "./keyboardInset";

/**
 * Publishes the on-screen keyboard to CSS so fixed and sticky UI can sit above
 * it: `--mq-keyboard-inset` on <html> (px the keyboard covers) and the
 * `mq-keyboard-open` class while it is up. Touch devices only.
 */
export default function KeyboardInsetSync() {
  useEffect(() => {
    if (typeof window.matchMedia !== "function" || !window.matchMedia("(pointer: coarse)").matches) return;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let tallest = viewport?.height ?? window.innerHeight;
    let width = window.innerWidth;
    let frame = 0;

    const update = () => {
      frame = 0;
      if (window.innerWidth !== width) {
        // Rotation: the old tallest height no longer applies.
        width = window.innerWidth;
        tallest = 0;
      }
      const height = viewport?.height ?? window.innerHeight;
      const focused = opensKeyboard(document.activeElement);
      if (!focused) tallest = Math.max(tallest, height);
      const inset = viewport ? keyboardInset(window.innerHeight, viewport) : 0;
      const open = viewport ? isKeyboardOpen(focused, inset, height, tallest) : focused;
      root.style.setProperty("--mq-keyboard-inset", `${open ? inset : 0}px`);
      root.classList.toggle("mq-keyboard-open", open);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    // focusout fires before focus lands on the next field; wait a tick.
    const onFocusOut = () => window.setTimeout(schedule, 50);

    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", onFocusOut);
    update();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", onFocusOut);
      root.style.removeProperty("--mq-keyboard-inset");
      root.classList.remove("mq-keyboard-open");
    };
  }, []);

  return null;
}
