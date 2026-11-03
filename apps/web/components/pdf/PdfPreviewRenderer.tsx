"use client";

import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PdfPreviewProps } from "./PdfPreview";
import PdfPreviewLoading from "./PdfPreviewLoading";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type RendererProps = Omit<PdfPreviewProps, "ariaLabel" | "className">;

// LinkedIn carousels are usually 4:5; the first page replaces this once it loads.
const DEFAULT_PAGE_ASPECT = 4 / 5;
const MIN_FITTED_PAGE_HEIGHT = 240;
// A mouse that travels further than this between press and release was dragging the rail, not clicking a page.
const DRAG_CLICK_TOLERANCE = 4;

type DragState = {
  pointerId: number;
  startX: number;
  scrollLeft: number;
  moved: boolean;
};

export default function PdfPreviewRenderer({
  source,
  title,
  pageCountHint,
  openHref,
  showHeader = true,
  fitViewportOffset,
  maxPageWidth = 560,
  onPageChange,
  onExpand,
}: RendererProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const dragRef = useRef<DragState | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageWidth, setPageWidth] = useState(280);
  const [pageAspect, setPageAspect] = useState(DEFAULT_PAGE_ASPECT);
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
  const handlePageError = useCallback((pageError: Error) => {
    setError(pageError.message || "A PDF page could not be rendered.");
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const updateWidth = () => {
      let width = Math.min(maxPageWidth, rail.clientWidth - 36);
      if (typeof fitViewportOffset === "number") {
        const fittedHeight = Math.max(MIN_FITTED_PAGE_HEIGHT, window.innerHeight - fitViewportOffset);
        width = Math.min(width, fittedHeight * pageAspect);
      }
      setPageWidth(Math.max(180, Math.floor(width)));
    };
    updateWidth();

    window.addEventListener("resize", updateWidth);
    if (!("ResizeObserver" in window)) return () => window.removeEventListener("resize", updateWidth);
    const observer = new ResizeObserver(updateWidth);
    observer.observe(rail);
    return () => {
      window.removeEventListener("resize", updateWidth);
      observer.disconnect();
    };
  }, [error, fitViewportOffset, maxPageWidth, numPages, pageAspect]);

  useEffect(() => {
    if (!numPages) return;
    onPageChange?.(currentPage, numPages);
  }, [currentPage, numPages, onPageChange]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  function closestPage() {
    const rail = railRef.current;
    const firstPage = pageRefs.current[0];
    if (!rail || !firstPage) return currentPage;

    let closest = currentPage;
    let closestDistance = Number.POSITIVE_INFINITY;
    const firstPageLeft = firstPage.getBoundingClientRect().left;
    pageRefs.current.forEach((page, index) => {
      if (!page) return;
      const pageTarget = page.getBoundingClientRect().left - firstPageLeft;
      const distance = Math.abs(pageTarget - rail.scrollLeft);
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
    const firstPage = pageRefs.current[0];
    const page = pageRefs.current[pageNumber - 1];
    if (!rail || !firstPage || !page) return;
    const targetLeft = page.getBoundingClientRect().left - firstPage.getBoundingClientRect().left;
    rail.scrollTo({ left: targetLeft, behavior });
    setCurrentPage(pageNumber);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    suppressClickRef.current = false;
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    const rail = railRef.current;
    if (!rail) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: rail.scrollLeft,
      moved: false,
    };
    rail.setPointerCapture(event.pointerId);
    setIsDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const rail = railRef.current;
    const drag = dragRef.current;
    if (!rail || !drag || drag.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - drag.startX) > DRAG_CLICK_TOLERANCE) drag.moved = true;
    rail.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
  }

  function finishDragging(event: ReactPointerEvent<HTMLDivElement>) {
    const rail = railRef.current;
    const drag = dragRef.current;
    if (!rail || !drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    suppressClickRef.current = drag.moved || Math.abs(event.clientX - drag.startX) > DRAG_CLICK_TOLERANCE;
    setIsDragging(false);
    if (rail.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId);
    scrollToPage(closestPage());
  }

  // The rail captures the mouse while it is pressed, so the click lands on the
  // rail rather than the page; handling it here covers both.
  function handleRailClick() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onExpand?.();
  }

  function handlePageKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onExpand?.();
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
      {showHeader ? (
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
      ) : null}

      <Document
        key={attempt}
        file={documentSource}
        className="mq-pdf-preview-document"
        loading={<PdfPreviewLoading pageCountHint={pageCountHint} />}
        error={null}
        onLoadSuccess={handleDocumentLoadSuccess}
        onLoadError={handleDocumentLoadError}
        onSourceError={handleSourceError}
      >
        {numPages ? (
          <div
            ref={railRef}
            className={`mq-pdf-preview-rail${isDragging ? " is-dragging" : ""}${onExpand ? " is-expandable" : ""}`}
            onScroll={handleScroll}
            onClick={onExpand ? handleRailClick : undefined}
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
                aria-label={onExpand ? `Expand document, page ${index + 1} of ${numPages}` : `Page ${index + 1} of ${numPages}`}
                {...(onExpand ? {
                  role: "button",
                  // One tab stop for the rail: the page the controls have brought into view.
                  tabIndex: index + 1 === currentPage ? 0 : -1,
                  onKeyDown: handlePageKeyDown,
                } : {})}
              >
                <Page
                  pageNumber={index + 1}
                  width={pageWidth}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  onLoadSuccess={index === 0 ? (page) => {
                    const { originalWidth, originalHeight } = page;
                    if (originalWidth > 0 && originalHeight > 0) setPageAspect(originalWidth / originalHeight);
                  } : undefined}
                  onLoadError={handlePageError}
                  onRenderError={handlePageError}
                  loading={<div className="mq-pdf-preview-page-loading" style={{ width: pageWidth, aspectRatio: pageAspect }} aria-hidden="true" />}
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
