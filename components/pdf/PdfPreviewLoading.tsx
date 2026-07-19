export default function PdfPreviewLoading({ pageCountHint }: { pageCountHint?: number }) {
  return (
    <div className="mq-pdf-preview-loading" role="status" aria-live="polite">
      <div className="mq-pdf-preview-skeleton" aria-hidden="true" />
      <span>Loading PDF{pageCountHint ? ` · ${pageCountHint} pages` : ""}…</span>
    </div>
  );
}
