"use client";

import { useEffect } from "react";

/*
 * iOS Safari ignores `overflow: hidden` on <body>, so the page behind a modal
 * keeps scrolling and rubber-banding. Pinning the body with `position: fixed`
 * at the current scroll offset works everywhere; the offset is restored on
 * unlock. Locks are counted so nested modals don't release each other.
 */
let lockCount = 0;
let savedScrollY = 0;
let savedStyle = "";

export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  if (lockCount === 0) {
    const { body } = document;
    savedScrollY = window.scrollY;
    savedStyle = body.getAttribute("style") ?? "";
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    Object.assign(body.style, {
      position: "fixed",
      top: `-${savedScrollY}px`,
      left: "0",
      right: "0",
      width: "100%",
      overflow: "hidden",
      ...(scrollbarWidth > 0 ? { paddingRight: `${scrollbarWidth}px` } : {}),
    });
  }
  lockCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount -= 1;
    if (lockCount > 0) return;
    const { body } = document;
    if (savedStyle) body.setAttribute("style", savedStyle);
    else body.removeAttribute("style");
    window.scrollTo(0, savedScrollY);
  };
}

/** Locks page scroll while `active` is true. */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => (active ? lockBodyScroll() : undefined), [active]);
}
