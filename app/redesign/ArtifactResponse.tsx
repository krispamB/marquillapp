"use client";

import {
  BarChart3,
  Coins,
  ExternalLink,
  FileText,
  GalleryHorizontal,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import type {
  ArtifactDetailData,
  ArtifactType,
  UpdateArtifactRequest,
} from "./artifactTypes";

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

const pollDurations = [1, 3, 7, 14] as const;

function validatePollOptions(options: string[]) {
  if (options.length < 2 || options.length > 4) return "Polls need between 2 and 4 options.";
  const trimmed = options.map((option) => option.trim());
  if (trimmed.some((option) => !option)) return "Every poll option needs text.";
  if (trimmed.some((option) => option.length > 30)) return "Poll options must be 30 characters or fewer.";
  const unique = new Set(trimmed.map((option) => option.toLocaleLowerCase()));
  if (unique.size !== trimmed.length) return "Poll options must be unique.";
  return null;
}

function ArtifactEditor({
  artifact,
  isSaving,
  serverError,
  onCancel,
  onSave,
}: {
  artifact: ArtifactDetailData;
  isSaving: boolean;
  serverError?: string | null;
  onCancel: () => void;
  onSave: (request: UpdateArtifactRequest) => Promise<void>;
}) {
  const poll = artifact.content.poll;
  const hadPollCommentary = Boolean(artifact.content.commentary?.trim());
  const [title, setTitle] = useState(artifact.title ?? "");
  const [commentary, setCommentary] = useState(artifact.content.commentary ?? "");
  const [question, setQuestion] = useState(poll?.question ?? "");
  const [options, setOptions] = useState(poll?.options ?? ["", ""]);
  const [durationDays, setDurationDays] = useState<1 | 3 | 7 | 14>(poll?.durationDays ?? 7);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function save() {
    const trimmedCommentary = commentary.trim();
    const trimmedTitle = title.trim();
    let request: UpdateArtifactRequest;

    if (artifact.type === "POST") {
      if (!trimmedCommentary) {
        setValidationError("Post commentary is required.");
        return;
      }
      if (trimmedCommentary.length > 3000) {
        setValidationError("Post commentary must be 3,000 characters or fewer.");
        return;
      }
      request = {
        ...(trimmedTitle ? { title: trimmedTitle } : {}),
        content: { commentary: trimmedCommentary },
      };
    } else {
      const trimmedQuestion = question.trim();
      if (!trimmedQuestion) {
        setValidationError("A poll question is required.");
        return;
      }
      if (trimmedQuestion.length > 140) {
        setValidationError("The poll question must be 140 characters or fewer.");
        return;
      }
      if (trimmedCommentary.length > 3000) {
        setValidationError("Poll commentary must be 3,000 characters or fewer.");
        return;
      }
      if (hadPollCommentary && !trimmedCommentary) {
        setValidationError("Existing poll commentary cannot be cleared, but it can be replaced.");
        return;
      }
      const optionError = validatePollOptions(options);
      if (optionError) {
        setValidationError(optionError);
        return;
      }
      request = {
        ...(trimmedTitle ? { title: trimmedTitle } : {}),
        content: {
          ...(trimmedCommentary ? { commentary: trimmedCommentary } : {}),
          poll: {
            question: trimmedQuestion,
            options: options.map((option) => option.trim()),
            durationDays,
          },
        },
      };
    }

    setValidationError(null);
    try {
      await onSave(request);
    } catch {
      // The parent exposes the normalized server error without discarding this draft.
    }
  }

  return (
    <div className="mq-artifact-editor">
      <label>
        <span>Title</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} disabled={isSaving} />
      </label>
      <label>
        <span>{artifact.type === "POST" ? "Post commentary" : "Commentary (optional)"}</span>
        <textarea
          value={commentary}
          onChange={(event) => setCommentary(event.target.value)}
          maxLength={3000}
          rows={7}
          disabled={isSaving}
        />
        <small>{commentary.length.toLocaleString()} / 3,000</small>
      </label>

      {artifact.type === "POLL" ? (
        <>
          <label>
            <span>Question</span>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={140}
              rows={2}
              disabled={isSaving}
            />
            <small>{question.length} / 140</small>
          </label>
          <fieldset className="mq-artifact-editor-options">
            <legend>Options</legend>
            {options.map((option, index) => (
              <div key={index}>
                <label>
                  <span>Option {index + 1}</span>
                  <input
                    value={option}
                    onChange={(event) => setOptions((current) => current.map((value, optionIndex) => (
                      optionIndex === index ? event.target.value : value
                    )))}
                    maxLength={30}
                    disabled={isSaving}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setOptions((current) => current.filter((_, optionIndex) => optionIndex !== index))}
                  disabled={isSaving || options.length <= 2}
                  aria-label={`Remove option ${index + 1}`}
                  title="Remove option"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {options.length < 4 ? (
              <button
                type="button"
                className="mq-artifact-editor-add"
                onClick={() => setOptions((current) => [...current, ""])}
                disabled={isSaving}
              >
                <Plus size={14} /> Add option
              </button>
            ) : null}
          </fieldset>
          <label className="mq-artifact-editor-duration">
            <span>Poll duration</span>
            <select
              value={durationDays}
              onChange={(event) => setDurationDays(Number(event.target.value) as 1 | 3 | 7 | 14)}
              disabled={isSaving}
            >
              {pollDurations.map((days) => (
                <option value={days} key={days}>{days} day{days === 1 ? "" : "s"}</option>
              ))}
            </select>
          </label>
        </>
      ) : null}

      {validationError || serverError ? (
        <p className="mq-artifact-editor-error" role="alert">{validationError ?? serverError}</p>
      ) : null}
      <div className="mq-artifact-editor-actions">
        <button type="button" className="mq-secondary-button" onClick={onCancel} disabled={isSaving}>
          <X size={14} /> Cancel
        </button>
        <button type="button" className="mq-primary-button" onClick={() => void save()} disabled={isSaving}>
          {isSaving ? <LoaderCircle size={15} /> : <Save size={14} />}
          {isSaving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

export default function ArtifactResponse({
  artifact,
  credits,
  canEdit = false,
  isSaving = false,
  editError,
  onEditingChange,
  onSave,
}: {
  artifact: ArtifactDetailData;
  credits?: number;
  canEdit?: boolean;
  isSaving?: boolean;
  editError?: string | null;
  onEditingChange?: (isEditing: boolean) => void;
  onSave?: (request: UpdateArtifactRequest) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const TypeIcon = artifactTypeIcons[artifact.type];
  const ResponseBody = responseBodies[artifact.type];

  function setEditing(next: boolean) {
    setIsEditing(next);
    onEditingChange?.(next);
  }

  return (
    <article className="mq-studio-response">
      <header className="mq-studio-response-head">
        <div className="mq-studio-response-labels">
          <span className={`mq-artifact-type mq-artifact-type-${artifact.type.toLowerCase()}`}>
            <TypeIcon size={13} /> {artifactTypeLabels[artifact.type]}
          </span>
          <span className="mq-studio-version">v{artifact.version}</span>
        </div>
        {canEdit && !isEditing ? (
          <button type="button" className="mq-studio-edit" onClick={() => setEditing(true)}>
            <Pencil size={14} /> Edit
          </button>
        ) : null}
      </header>

      <div className="mq-studio-response-body">
        {isEditing && canEdit && onSave ? (
          <ArtifactEditor
            artifact={artifact}
            isSaving={isSaving}
            serverError={editError}
            onCancel={() => setEditing(false)}
            onSave={async (request) => {
              await onSave(request);
              setEditing(false);
            }}
          />
        ) : (
          <>
            <ResponseBody artifact={artifact} />
            {editError ? <p className="mq-artifact-editor-error" role="alert">{editError}</p> : null}
          </>
        )}
      </div>

      <footer className="mq-studio-response-foot">
        <span>Created by Mark</span>
        {typeof credits === "number" && credits > 0 ? <span><Coins size={13} /> {credits} credits</span> : null}
      </footer>
    </article>
  );
}
