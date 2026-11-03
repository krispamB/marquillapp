"use client";

import { useCallback, useState } from "react";
import PdfLightbox from "./PdfLightbox";
import type { PdfSource } from "./PdfPreview";

/**
 * The full-screen viewer for one PDF, opened from wherever that PDF is shown.
 * Render `lightbox` once beside the preview and wire `open` to whatever expands it.
 */
export default function usePdfLightbox({
  source,
  title,
  pageCountHint,
  openHref,
}: {
  source?: PdfSource;
  title?: string;
  pageCountHint?: number;
  openHref?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const lightbox = isOpen && source ? (
    <PdfLightbox
      source={source}
      title={title}
      pageCountHint={pageCountHint}
      openHref={openHref}
      onClose={close}
    />
  ) : null;

  return { open, lightbox };
}
