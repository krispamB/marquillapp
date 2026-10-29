"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import PdfPreview, { type PdfSource } from "./PdfPreview";

/** A full-screen viewer for reading a PDF's pages at the largest size the screen allows. */
export default function PdfLightbox({
  source,
  title,
  pageCountHint,
  openHref,
  onClose,
}: {
  source: PdfSource;
  title?: string;
  pageCountHint?: number;
  openHref?: string;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [isClosing, setIsClosing] = useState(false);
  const requestClose = useCallback(() => setIsClosing(true), []);

  // Unmount once the exit animation finishes; close at once when nothing animates (reduced motion).
  useEffect(() => {
    if (!isClosing) return;
    const animations = [overlayRef.current, panelRef.current].flatMap((element) => element?.getAnimations?.() ?? []);
    if (animations.length === 0) {
      onClose();
      return;
    }
    let cancelled = false;
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (!cancelled) onClose();
    });
    return () => {
      cancelled = true;
    };
  }, [isClosing, onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") requestClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [requestClose]);

  return createPortal(
    <div
      ref={overlayRef}
      className={`mq-pdf-lightbox${isClosing ? " is-closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={title ? `${title} full-screen preview` : "Full-screen PDF preview"}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div ref={panelRef} className="mq-pdf-lightbox-panel">
        <button ref={closeRef} type="button" className="mq-pdf-lightbox-close" onClick={requestClose} aria-label="Close full-screen preview">
          <X size={18} />
        </button>
        <PdfPreview
          source={source}
          title={title}
          pageCountHint={pageCountHint}
          openHref={openHref}
          fitViewportOffset={190}
          maxPageWidth={960}
          className="mq-pdf-preview-lightbox"
        />
      </div>
    </div>,
    document.body,
  );
}
