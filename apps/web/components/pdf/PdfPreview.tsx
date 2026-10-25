"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import PdfPreviewLoading from "./PdfPreviewLoading";

export type PdfSource = string | File | ArrayBuffer | Uint8Array;

export type PdfPreviewProps = {
  source: PdfSource;
  title?: string;
  pageCountHint?: number;
  openHref?: string;
  ariaLabel?: string;
  className?: string;
  /** Hide the title row when the surrounding card already names the PDF. */
  showHeader?: boolean;
  /**
   * Vertical space, in px, the rest of the screen needs around a page. Pages
   * shrink so a whole page stays visible within `innerHeight - fitViewportOffset`.
   */
  fitViewportOffset?: number;
  maxPageWidth?: number;
  onPageChange?: (page: number, totalPages: number) => void;
  /** Makes the pages a button that opens the full-screen viewer. */
  onExpand?: () => void;
};

const PdfPreviewRenderer = dynamic(() => import("./PdfPreviewRenderer"), {
  ssr: false,
  loading: () => <PdfPreviewLoading />,
});

export default function PdfPreview({
  source,
  title,
  pageCountHint,
  openHref,
  ariaLabel,
  className,
  showHeader,
  fitViewportOffset,
  maxPageWidth,
  onPageChange,
  onExpand,
}: PdfPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    if (!("IntersectionObserver" in window)) {
      const frame = requestAnimationFrame(() => setIsVisible(true));
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setIsVisible(true);
        observer.disconnect();
      },
      { rootMargin: "180px" },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      className={["mq-pdf-preview", className].filter(Boolean).join(" ")}
      style={typeof fitViewportOffset === "number"
        ? { "--mq-pdf-fit-height": `max(240px, calc(100dvh - ${fitViewportOffset}px))` } as CSSProperties
        : undefined}
      aria-label={ariaLabel ?? (title ? `${title} PDF preview` : "PDF preview")}
    >
      {isVisible ? (
        <PdfPreviewRenderer
          source={source}
          title={title}
          pageCountHint={pageCountHint}
          openHref={openHref}
          showHeader={showHeader}
          fitViewportOffset={fitViewportOffset}
          maxPageWidth={maxPageWidth}
          onPageChange={onPageChange}
          onExpand={onExpand}
        />
      ) : (
        <PdfPreviewLoading pageCountHint={pageCountHint} />
      )}
    </div>
  );
}
