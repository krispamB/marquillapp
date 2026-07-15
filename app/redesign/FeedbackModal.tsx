"use client";

import { useEffect, useState } from "react";
import { Bug, Check, Lightbulb, X, XCircle } from "lucide-react";
import { API_BASE, jsonRequest, readApi } from "./api";
import MarquillSelect, { type MarquillSelectOption } from "../../components/ui/MarquillSelect";

type FeedbackKind = "BUG" | "FEATURE_REQUEST";
type ModalState = "form" | "submitting" | "success" | "error";

type FeedbackResponse = {
  data?: { issueUrl?: string };
};

const feedbackKinds: MarquillSelectOption[] = [
  { value: "BUG", label: "Report a bug", icon: <Bug size={15} /> },
  { value: "FEATURE_REQUEST", label: "Suggest a feature", icon: <Lightbulb size={15} /> },
];

type NavigatorReport = Navigator & {
  userAgentData?: {
    brands?: Array<{ brand: string; version: string }>;
    platform?: string;
  };
};

async function getDeviceReport() {
  const browserNavigator = navigator as NavigatorReport;
  const brands = browserNavigator.userAgentData?.brands;
  return {
    browser: brands?.length ? brands.map((item) => `${item.brand} ${item.version}`).join(", ") : navigator.userAgent,
    os: browserNavigator.userAgentData?.platform ?? navigator.platform,
    screenResolution: `${window.screen.width}x${window.screen.height}`,
    viewportSize: `${window.innerWidth}x${window.innerHeight}`,
    language: navigator.language,
  };
}

export default function FeedbackModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [modalState, setModalState] = useState<ModalState>("form");
  const [kind, setKind] = useState<FeedbackKind>("BUG");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [issueUrl, setIssueUrl] = useState("");
  const [errorMessage, setErrorMessage] = useState("We could not send that report.");

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !description.trim()) return;
    setModalState("submitting");
    try {
      const response = await readApi<FeedbackResponse>(
        `${API_BASE}/feedback/issues`,
        jsonRequest({ type: kind, title: title.trim(), description: description.trim(), deviceReport: await getDeviceReport() }, { method: "POST" }),
      );
      setIssueUrl(response?.data?.issueUrl ?? "");
      setModalState("success");
    } catch (reason) {
      setErrorMessage(reason instanceof Error ? reason.message : "We could not send that report.");
      setModalState("error");
    }
  }

  return (
    <div className="mq-feedback-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="mq-feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
        <button type="button" className="mq-feedback-close" onClick={onClose} aria-label="Close feedback dialog"><X size={17} /></button>
        {modalState === "form" || modalState === "submitting" ? (
          <>
            <header className="mq-feedback-header">
              <span className="mq-feedback-type-icon" aria-hidden="true">{kind === "BUG" ? <Bug size={19} /> : <Lightbulb size={19} />}</span>
              <div>
                <span className="mq-eyebrow">Help & feedback</span>
                <h2 id="feedback-title">Tell us what happened</h2>
                <p className="mq-feedback-intro">A few clear details help Mark&apos;s team find the right fix faster.</p>
              </div>
            </header>
            <form onSubmit={submit} className="mq-feedback-form">
              <div className="mq-feedback-field">
                <label htmlFor="feedback-kind">I would like to</label>
                <MarquillSelect id="feedback-kind" value={kind} onChange={(value) => setKind(value as FeedbackKind)} options={feedbackKinds} />
              </div>
              <div className="mq-feedback-field">
                <label htmlFor="feedback-title-input">Title</label>
                <input id="feedback-title-input" required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="A short, specific summary" />
              </div>
              <div className="mq-feedback-field">
                <label htmlFor="feedback-description">Description</label>
                <textarea id="feedback-description" required value={description} onChange={(event) => setDescription(event.target.value)} rows={5} placeholder="What were you trying to do? What did you expect, and what happened instead?" />
              </div>
              <footer className="mq-feedback-actions"><span>Browser and viewport details are added automatically.</span><button type="submit" className="mq-primary-button" disabled={modalState === "submitting" || !title.trim() || !description.trim()}>{modalState === "submitting" ? "Sending…" : "Send report"}</button></footer>
            </form>
          </>
        ) : null}
        {modalState === "success" ? (
          <div className="mq-feedback-result">
            <span className="mq-feedback-result-icon is-success"><Check size={24} /></span>
            <span className="mq-eyebrow">Received</span>
            <h2 id="feedback-title">Thanks for the signal.</h2>
            <p>Your {kind === "BUG" ? "bug report" : "feature request"} is in the queue.</p>
            {issueUrl ? <a href={issueUrl} target="_blank" rel="noopener noreferrer" className="mq-secondary-button">Track request</a> : null}
            <button type="button" className="mq-ghost-button" onClick={onClose}>Close</button>
          </div>
        ) : null}
        {modalState === "error" ? (
          <div className="mq-feedback-result">
            <span className="mq-feedback-result-icon is-error"><XCircle size={24} /></span>
            <span className="mq-eyebrow">Could not send</span>
            <h2 id="feedback-title">That report did not go through.</h2>
            <p className="mq-feedback-error">{errorMessage}</p>
            <button type="button" className="mq-primary-button" onClick={() => setModalState("form")}>Try again</button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
