import type { ReactNode } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import type { ArtifactDetailData } from "./artifactTypes";

const contentLabels = {
  POST: "Post content",
  POLL: "Poll content",
  DOCUMENT: "Document content",
} as const;

export function artifactSummaryCopy(artifact: ArtifactDetailData) {
  if (artifact.content.commentary?.trim()) return artifact.content.commentary.trim();
  if (artifact.content.poll) return artifact.content.poll.question;
  const firstSlide = artifact.content.document?.slides[0];
  if (firstSlide) return Object.values(firstSlide.fields).filter((value) => typeof value === "string").join(" · ");
  return "This artifact is ready to publish.";
}

export function ArtifactContentView({ artifact, variant }: { artifact: ArtifactDetailData; variant: "composer" | "preview" }) {
  const commentary = artifact.content.commentary?.trim();
  const poll = artifact.type === "POLL" ? artifact.content.poll : undefined;
  const document = artifact.type === "DOCUMENT" ? artifact.content.document : undefined;

  return (
    <>
      {commentary ? <div className={variant === "preview" ? "mq-linkedin-content is-expanded" : "mq-readonly-commentary"}>{commentary}</div> : null}
      {poll ? (
        <div className={variant === "preview" ? "mq-preview-poll" : "mq-readonly-poll"}>
          <strong>{poll.question}</strong>
          {poll.options.map((option) => <span key={option}>{option}</span>)}
          <small>{poll.durationDays} day poll</small>
        </div>
      ) : null}
      {document ? (
        <div className={variant === "preview" ? "mq-preview-document" : "mq-readonly-document"}>
          <FileText size={variant === "preview" ? 28 : 30} />
          <span>
            <strong>{variant === "preview" ? artifact.title?.trim() || "LinkedIn document" : `${document.slides.length} slides`}</strong>
            <small>{variant === "preview" ? `${document.pageCount ?? document.slides.length} pages · PDF` : `${document.templateId} theme`}</small>
          </span>
          {document.pdfUrl ? <a href={document.pdfUrl} target="_blank" rel="noreferrer">{variant === "preview" ? "Preview PDF" : "Open PDF"}</a> : null}
        </div>
      ) : null}
    </>
  );
}

export default function AttachedArtifactComposition({
  artifact,
  busy,
  onSwap,
  mediaControls,
}: {
  artifact: ArtifactDetailData;
  busy: boolean;
  onSwap: () => void;
  mediaControls?: ReactNode;
}) {
  return (
    <>
      <article className="mq-card mq-attached-artifact">
        <header><span className="mq-mono">_ attached artifact</span><button type="button" onClick={onSwap} disabled={busy}>Swap</button></header>
        <div><span className={`mq-artifact-pick-icon is-${artifact.type.toLowerCase()}`}><FileText size={18} /></span><span><strong>{artifact.title?.trim() || "Untitled artifact"}</strong><small><b>{artifact.type}</b> · v{artifact.version}</small><p>{artifactSummaryCopy(artifact)}</p></span></div>
      </article>
      <article className="mq-card mq-readonly-artifact-content">
        <header><strong>{contentLabels[artifact.type]}</strong><Link href={`/artifacts/${encodeURIComponent(artifact.id)}`}>Edit in Studio</Link><span className="mq-mono">{artifact.content.commentary?.length ?? 0}/3000</span></header>
        <ArtifactContentView artifact={artifact} variant="composer" />
        {mediaControls}
      </article>
    </>
  );
}
