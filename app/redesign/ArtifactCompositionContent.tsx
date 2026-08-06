"use client";

import { useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import PdfPreview from "../../components/pdf/PdfPreview";
import type { ArtifactDetailData } from "./artifactTypes";
import { artifactTypeIcons } from "./artifactPresentation";
import { truncatePostPreview } from "./postPreviewCutoff";

export function artifactSummaryCopy(artifact: ArtifactDetailData) {
  if (artifact.content.commentary?.trim()) return artifact.content.commentary.trim();
  if (artifact.content.poll) return artifact.content.poll.question;
  const firstSlide = artifact.content.document?.slides[0];
  if (firstSlide) return Object.values(firstSlide.fields).filter((value) => typeof value === "string").join(" · ");
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

export function ArtifactContentView({ artifact }: { artifact: ArtifactDetailData }) {
  const commentary = artifact.content.commentary?.trim();
  const poll = artifact.type === "POLL" ? artifact.content.poll : undefined;
  const document = artifact.type === "DOCUMENT" ? artifact.content.document : undefined;

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
            title={artifact.title?.trim() || "LinkedIn document"}
            pageCountHint={document.pageCount ?? document.slides.length}
            openHref={document.pdfUrl}
            ariaLabel={`${artifact.title?.trim() || "LinkedIn document"} carousel preview`}
            className="mq-pdf-preview-composition"
          />
        ) : (
          <div className="mq-preview-document">
            <FileText size={28} />
            <span>
              <strong>{artifact.title?.trim() || "LinkedIn document"}</strong>
              <small>{document.pageCount ?? document.slides.length} pages · PDF</small>
            </span>
            <small>PDF preview unavailable</small>
          </div>
        )
      ) : null}
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

  return (
    <>
      <article className="mq-card mq-attached-artifact">
        <header><span className="mq-mono">_ attached artifact</span>{canSwap ? <button type="button" onClick={onSwap} disabled={busy}>Swap</button> : null}</header>
        <div><span className={`mq-artifact-pick-icon is-${artifact.type.toLowerCase()}`}><ArtifactIcon size={18} /></span><span><strong>{artifact.title?.trim() || "Untitled artifact"}</strong><small><b>{artifact.type}</b> · v{artifact.version}</small><p>{artifactSummaryCopy(artifact)}</p></span></div>
      </article>
      {mediaControls ? <article className="mq-card mq-post-media-card">{mediaControls}</article> : null}
    </>
  );
}
