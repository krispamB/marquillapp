"use client";

import {
  BarChart3,
  Coins,
  ExternalLink,
  FileText,
  GalleryHorizontal,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import type { ArtifactDetailData, ArtifactType } from "./artifactTypes";

export const artifactTypeLabels: Record<ArtifactType, string> = {
  POST: "Post",
  POLL: "Poll",
  DOCUMENT: "Carousel",
};

const artifactTypeIcons: Record<ArtifactType, LucideIcon> = {
  POST: FileText,
  POLL: BarChart3,
  DOCUMENT: GalleryHorizontal,
};

function PostResponse({ artifact }: { artifact: ArtifactDetailData }) {
  return (
    <div className="mq-studio-post-copy">
      {artifact.content.commentary?.trim() || "No post copy was returned."}
    </div>
  );
}

function PollResponse({ artifact }: { artifact: ArtifactDetailData }) {
  const commentary = artifact.content.commentary?.trim();
  const poll = artifact.content.poll;

  return (
    <div className="mq-studio-poll-copy">
      {commentary ? <p>{commentary}</p> : null}
      <label>
        <span>Question</span>
        <textarea value={poll?.question ?? ""} readOnly rows={2} aria-label="Poll question" />
      </label>
      <div className="mq-studio-poll-options">
        {(poll?.options ?? []).map((option, index) => (
          <label key={`${option}-${index}`}>
            <span>Option {index + 1}</span>
            <input value={option} readOnly aria-label={`Poll option ${index + 1}`} />
          </label>
        ))}
      </div>
      {poll ? <small>Open for {poll.durationDays} day{poll.durationDays === 1 ? "" : "s"}</small> : null}
    </div>
  );
}

function DocumentResponse({ artifact }: { artifact: ArtifactDetailData }) {
  const commentary = artifact.content.commentary?.trim();
  const document = artifact.content.document;

  return (
    <div className="mq-studio-document-copy">
      <div className="mq-studio-document-icon"><FileText size={22} /></div>
      <div>
        <strong>{artifact.title?.trim() || "Your carousel is ready"}</strong>
        {commentary ? <p>{commentary}</p> : null}
        <span>{document?.pageCount ?? document?.slides.length ?? 0} pages</span>
      </div>
      {document?.pdfUrl ? (
        <a href={document.pdfUrl} target="_blank" rel="noreferrer">
          Open PDF <ExternalLink size={14} />
        </a>
      ) : (
        <span className="mq-studio-pdf-pending">PDF link unavailable</span>
      )}
    </div>
  );
}

const responseBodies: Record<ArtifactType, typeof PostResponse> = {
  POST: PostResponse,
  POLL: PollResponse,
  DOCUMENT: DocumentResponse,
};

export default function ArtifactResponse({
  artifact,
  credits,
}: {
  artifact: ArtifactDetailData;
  credits?: number;
}) {
  const TypeIcon = artifactTypeIcons[artifact.type];
  const ResponseBody = responseBodies[artifact.type];
  const isEditableType = artifact.type === "POST" || artifact.type === "POLL";

  return (
    <article className="mq-studio-response">
      <header className="mq-studio-response-head">
        <div className="mq-studio-response-labels">
          <span className={`mq-artifact-type mq-artifact-type-${artifact.type.toLowerCase()}`}>
            <TypeIcon size={13} /> {artifactTypeLabels[artifact.type]}
          </span>
          <span className="mq-studio-version">v{artifact.version}</span>
        </div>
        {isEditableType ? (
          <button type="button" className="mq-studio-edit" disabled title="Artifact editing is coming next">
            <Pencil size={14} /> Edit
          </button>
        ) : null}
      </header>

      <div className="mq-studio-response-body"><ResponseBody artifact={artifact} /></div>

      <footer className="mq-studio-response-foot">
        <span>Created by Mark</span>
        {typeof credits === "number" && credits > 0 ? <span><Coins size={13} /> {credits} credits</span> : null}
      </footer>
    </article>
  );
}
