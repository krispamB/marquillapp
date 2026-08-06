"use client";

import { AlertTriangle, X } from "lucide-react";

export default function DeleteConfirmModal({
  isOpen,
  isPublished,
  isDeleting,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  isPublished: boolean;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="mq-feedback-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="mq-feedback-modal mq-delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-post-title">
        <button type="button" className="mq-feedback-close" onClick={onClose} disabled={isDeleting} aria-label="Close delete dialog"><X size={17} /></button>
        <div className="mq-feedback-result">
          <span className="mq-feedback-result-icon is-error"><AlertTriangle size={24} /></span>
          <span className="mq-eyebrow">Permanent action</span>
          <h2 id="delete-post-title">Delete post?</h2>
          <p>This cannot be undone.</p>
          {isPublished ? <p className="mq-delete-warning">This published post will also be removed from LinkedIn.</p> : null}
          <div className="mq-delete-actions">
            <button type="button" className="mq-secondary-button" onClick={onClose} disabled={isDeleting}>Keep post</button>
            <button type="button" className="mq-delete-button" onClick={onConfirm} disabled={isDeleting}>{isDeleting ? "Deleting…" : "Delete post"}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
