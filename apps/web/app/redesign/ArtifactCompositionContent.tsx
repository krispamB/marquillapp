"use client";

import { useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import PdfPreview from "../../components/pdf/PdfPreview";
import PdfThumbnail from "../../components/pdf/PdfThumbnail";
import usePdfLightbox from "../../components/pdf/usePdfLightbox";
import type { ArtifactDetailData } from "./artifactTypes";
import { artifactTypeIcons, artifactTypeLabels } from "./artifactPresentation";
import { truncatePostPreview } from "./postPreviewCutoff";

export function artifactSummaryCopy(artifact: ArtifactDetailData) {
  if (artifact.content.commentary?.trim()) return artifact.content.commentary.trim();
  if (artifact.content.poll) return artifact.content.poll.question;
  const document = artifact.content.document;
  if (document) return `${document.pageCount}-page document in ${document.designSystemName}`;
  return "This artifact is ready to publish.";
}

function ExpandablePostCommentary({ commentary }: { commentary: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const preview = truncatePostPreview(commentary);

  return (
    <div className="mq-linkedin-content is-expanded">
      {isExpanded ? commentary : preview.content}
      {preview.isTruncated && !isExpanded ? (
        <button
          type="button"
          className="mq-linkedin-more-inline"
          onClick={() => setIsExpanded(true)}
          aria-expanded={isExpanded}
        >
          more...
        </button>
      ) : null}
    </div>
  );
}

// The topbar, the LinkedIn author row, a few lines of commentary and the slide
// controls sit around a slide in the composer preview.
const PREVIEW_SLIDE_VIEWPORT_OFFSET = 380;

export function ArtifactContentView({ artifact }: { artifact: ArtifactDetailData }) {
  const commentary = artifact.content.commentary?.trim();
  const poll = artifact.type === "POLL" ? artifact.content.poll : undefined;
  const document = artifact.type === "DOCUMENT" ? artifact.content.document : undefined;
  const documentTitle = artifact.title?.trim() || "LinkedIn document";
  const { open: openLightbox, lightbox } = usePdfLightbox({
    source: document?.pdfUrl,
    title: documentTitle,
    pageCountHint: document?.pageCount,
    openHref: document?.pdfUrl,
  });

  return (
    <>
      {commentary && artifact.type === "POST" ? (
        <ExpandablePostCommentary key={`${artifact.id}:${artifact.version}`} commentary={commentary} />
      ) : commentary ? <div className="mq-linkedin-content is-expanded">{commentary}</div> : null}
      {poll ? (
        <div className="mq-preview-poll">
          <strong>{poll.question}</strong>
          {poll.options.map((option) => <span key={option}>{option}</span>)}
          <small>{poll.durationDays} day poll</small>
        </div>
      ) : null}
      {document ? (
        document.pdfUrl ? (
          <PdfPreview
            source={document.pdfUrl}
            title={documentTitle}
            pageCountHint={document.pageCount}
            openHref={document.pdfUrl}
            ariaLabel={`${documentTitle} carousel preview`}
            className="mq-pdf-preview-composition"
            fitViewportOffset={PREVIEW_SLIDE_VIEWPORT_OFFSET}
            onExpand={openLightbox}
          />
        ) : (
          <div className="mq-preview-document">
            <FileText size={28} />
            <span>
              <strong>{documentTitle}</strong>
              <small>{document.pageCount} pages · PDF</small>
            </span>
            <small>PDF preview unavailable</small>
          </div>
        )
      ) : null}
      {lightbox}
    </>
  );
}

export default function AttachedArtifactComposition({
  artifact,
  busy,
  canSwap = true,
  onSwap,
  mediaControls,
}: {
  artifact: ArtifactDetailData;
  busy: boolean;
  canSwap?: boolean;
  onSwap: () => void;
  mediaControls?: ReactNode;
}) {
  const ArtifactIcon = artifactTypeIcons[artifact.type];
  const title = artifact.title?.trim() || "Untitled artifact";
  const document = artifact.type === "DOCUMENT" ? artifact.content.document : undefined;
  const { open: openLightbox, lightbox } = usePdfLightbox({
    source: document?.pdfUrl,
    title,
    pageCountHint: document?.pageCount,
    openHref: document?.pdfUrl,
  });

  return (
    <>
      <article className="mq-card mq-attached-artifact">
        <header><span className="mq-mono">_ attached artifact</span>{canSwap ? <button type="button" onClick={onSwap} disabled={busy}>Swap</button> : null}</header>
        <div>
          {document?.pdfUrl ? (
            <button type="button" className="mq-pdf-thumbnail-button" onClick={openLightbox} aria-label="Expand document" title="Expand">
              <PdfThumbnail source={document.pdfUrl} label={`${title} first page`} />
            </button>
          ) : (
            <span className={`mq-artifact-pick-icon is-${artifact.type.toLowerCase()}`}><ArtifactIcon size={18} /></span>
          )}
          <span>
            <strong>{title}</strong>
            <small><b>{artifactTypeLabels[artifact.type]}</b> · v{artifact.version}{document ? ` · ${document.pageCount} pages` : ""}</small>
            <p>{artifactSummaryCopy(artifact)}</p>
          </span>
        </div>
      </article>
      {mediaControls ? <article className="mq-card mq-post-media-card">{mediaControls}</article> : null}
      {lightbox}
    </>
  );
}
