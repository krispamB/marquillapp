"use client";

import { AlertTriangle, X } from "lucide-react";

export default function ArtifactDeleteConfirmModal({
  isOpen,
  isDeleting,
  artifactTitle,
  error,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  isDeleting: boolean;
  artifactTitle?: string;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div
      className="mq-feedback-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !isDeleting) onClose();
      }}
    >
      <section
        className="mq-feedback-modal mq-delete-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-artifact-title"
      >
        <button
          type="button"
          className="mq-feedback-close"
          onClick={onClose}
          disabled={isDeleting}
          aria-label="Close delete dialog"
        >
          <X size={17} />
        </button>
        <div className="mq-feedback-result">
          <span className="mq-feedback-result-icon is-error"><AlertTriangle size={24} /></span>
          <span className="mq-eyebrow">Permanent action</span>
          <h2 id="delete-artifact-title">Delete artifact?</h2>
          <p>
            {artifactTitle?.trim()
              ? `“${artifactTitle.trim()}” will be permanently removed.`
              : "This artifact will be permanently removed."}
          </p>
          <p>This cannot be undone.</p>
          {error ? <p className="mq-delete-error" role="alert">{error}</p> : null}
          <div className="mq-delete-actions">
            <button type="button" className="mq-secondary-button" onClick={onClose} disabled={isDeleting}>
              Keep artifact
            </button>
            <button type="button" className="mq-delete-button" onClick={onConfirm} disabled={isDeleting}>
              {isDeleting ? "Deleting…" : "Delete artifact"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
