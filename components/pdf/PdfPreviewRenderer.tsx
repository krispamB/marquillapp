"use client";

import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PdfPreviewProps } from "./PdfPreview";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type RendererProps = Omit<PdfPreviewProps, "ariaLabel" | "className">;

type DragState = {
  pointerId: number;
  startX: number;
  scrollLeft: number;
};

function LoadingPages({ pageCountHint }: { pageCountHint?: number }) {
  return (
    <div className="mq-pdf-preview-loading" role="status" aria-live="polite">
      <div className="mq-pdf-preview-skeleton" aria-hidden="true" />
      <span>Loading PDF{pageCountHint ? ` · ${pageCountHint} pages` : ""}…</span>
    </div>
  );
}

export default function PdfPreviewRenderer({
  source,
  title,
  pageCountHint,
  openHref,
  onPageChange,
}: RendererProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const dragRef = useRef<DragState | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageWidth, setPageWidth] = useState(280);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const displayedPageCount = numPages ?? pageCountHint;
  const documentSource = useMemo(
    () => source instanceof Uint8Array ? Uint8Array.from(source).buffer : source,
    [source],
  );
  const handleDocumentLoadSuccess = useCallback((pdf: { numPages: number }) => {
    setError(null);
    setNumPages(pdf.numPages);
    setCurrentPage(1);
    pageRefs.current = Array(pdf.numPages).fill(null);
  }, []);
  const handleDocumentLoadError = useCallback((loadError: Error) => {
    setError(loadError.message || "Check the PDF link and try again.");
  }, []);
  const handleSourceError = useCallback((sourceError: Error) => {
    setError(sourceError.message || "The PDF source is unavailable.");
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const updateWidth = () => {
      setPageWidth(Math.min(560, Math.max(180, rail.clientWidth - 36)));
    };
    updateWidth();

    if (!("ResizeObserver" in window)) return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [error, numPages]);

  useEffect(() => {
    if (!numPages) return;
    onPageChange?.(currentPage, numPages);
  }, [currentPage, numPages, onPageChange]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  function closestPage() {
    const rail = railRef.current;
    if (!rail || !pageRefs.current.length) return currentPage;

    let closest = currentPage;
    let closestDistance = Number.POSITIVE_INFINITY;
    pageRefs.current.forEach((page, index) => {
      if (!page) return;
      const distance = Math.abs(page.offsetLeft - rail.scrollLeft - rail.clientLeft);
      if (distance < closestDistance) {
        closest = index + 1;
        closestDistance = distance;
      }
    });
    return closest;
  }

  function handleScroll() {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => {
      setCurrentPage(closestPage());
      scrollFrameRef.current = null;
    });
  }

  function scrollToPage(pageNumber: number, behavior: ScrollBehavior = "smooth") {
    const rail = railRef.current;
    const page = pageRefs.current[pageNumber - 1];
    if (!rail || !page) return;
    rail.scrollTo({ left: page.offsetLeft - rail.clientLeft, behavior });
    setCurrentPage(pageNumber);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    const rail = railRef.current;
    if (!rail) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: rail.scrollLeft,
    };
    rail.setPointerCapture(event.pointerId);
    setIsDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const rail = railRef.current;
    const drag = dragRef.current;
    if (!rail || !drag || drag.pointerId !== event.pointerId) return;
    rail.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
  }

  function finishDragging(event: ReactPointerEvent<HTMLDivElement>) {
    const rail = railRef.current;
    const drag = dragRef.current;
    if (!rail || !drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
    if (rail.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId);
    scrollToPage(closestPage());
  }

  function retry() {
    setError(null);
    setNumPages(null);
    setCurrentPage(1);
    setAttempt((value) => value + 1);
  }

  if (error) {
    return (
      <div className="mq-pdf-preview-error" role="alert">
        <strong>We couldn’t display this PDF.</strong>
        <span>{error}</span>
        <div>
          <button type="button" onClick={retry}><RefreshCw size={14} /> Retry</button>
          {openHref ? (
            <a href={openHref} target="_blank" rel="noreferrer">
              Open PDF <ExternalLink size={14} />
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="mq-pdf-preview-head">
        <span>
          {title ? <strong>{title}</strong> : null}
          <small>{displayedPageCount ? `${displayedPageCount} pages · PDF` : "PDF document"}</small>
        </span>
        {openHref ? (
          <a href={openHref} target="_blank" rel="noreferrer">
            Open PDF <ExternalLink size={13} />
          </a>
        ) : null}
      </header>

      <Document
        key={attempt}
        file={documentSource}
        className="mq-pdf-preview-document"
        loading={<LoadingPages pageCountHint={pageCountHint} />}
        error={null}
        onLoadSuccess={handleDocumentLoadSuccess}
        onLoadError={handleDocumentLoadError}
        onSourceError={handleSourceError}
      >
        {numPages ? (
          <div
            ref={railRef}
            className={`mq-pdf-preview-rail${isDragging ? " is-dragging" : ""}`}
            onScroll={handleScroll}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDragging}
            onPointerCancel={finishDragging}
          >
            {Array.from({ length: numPages }, (_, index) => (
              <div
                key={index + 1}
                ref={(node) => { pageRefs.current[index] = node; }}
                className="mq-pdf-preview-page"
                aria-label={`Page ${index + 1} of ${numPages}`}
              >
                <Page
                  pageNumber={index + 1}
                  width={pageWidth}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  loading={<div className="mq-pdf-preview-page-loading" aria-hidden="true" />}
                  error={<div className="mq-pdf-preview-page-error">Page unavailable</div>}
                />
              </div>
            ))}
          </div>
        ) : null}
      </Document>

      {numPages ? (
        <footer className="mq-pdf-preview-controls">
          <button
            type="button"
            onClick={() => scrollToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label="Previous PDF page"
          >
            <ChevronLeft size={17} />
          </button>
          <span aria-live="polite">{currentPage} / {numPages}</span>
          <button
            type="button"
            onClick={() => scrollToPage(currentPage + 1)}
            disabled={currentPage >= numPages}
            aria-label="Next PDF page"
          >
            <ChevronRight size={17} />
          </button>
        </footer>
      ) : null}
    </>
  );
}
