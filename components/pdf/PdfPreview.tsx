"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

export type PdfSource = string | File | ArrayBuffer | Uint8Array;

export type PdfPreviewProps = {
  source: PdfSource;
  title?: string;
  pageCountHint?: number;
  openHref?: string;
  ariaLabel?: string;
  className?: string;
  onPageChange?: (page: number, totalPages: number) => void;
};

const PdfPreviewRenderer = dynamic(() => import("./PdfPreviewRenderer"), {
  ssr: false,
  loading: () => <PdfPreviewSkeleton />,
});

function PdfPreviewSkeleton({ pageCountHint }: { pageCountHint?: number }) {
  return (
    <div className="mq-pdf-preview-loading" role="status" aria-live="polite">
      <div className="mq-pdf-preview-skeleton" aria-hidden="true" />
      <span>Loading PDF{pageCountHint ? ` · ${pageCountHint} pages` : ""}…</span>
    </div>
  );
}

export default function PdfPreview({
  source,
  title,
  pageCountHint,
  openHref,
  ariaLabel,
  className,
  onPageChange,
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
      aria-label={ariaLabel ?? (title ? `${title} PDF preview` : "PDF preview")}
    >
      {isVisible ? (
        <PdfPreviewRenderer
          source={source}
          title={title}
          pageCountHint={pageCountHint}
          openHref={openHref}
          onPageChange={onPageChange}
        />
      ) : (
        <PdfPreviewSkeleton pageCountHint={pageCountHint} />
      )}
    </div>
  );
}
