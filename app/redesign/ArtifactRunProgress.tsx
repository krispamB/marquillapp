"use client";

import Link from "next/link";
import { useId, useState } from "react";
import {
  Check,
  ChevronDown,
  Circle,
  LoaderCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import type { ArtifactType, WorkflowStep } from "./artifactTypes";
import type { RunState, StepStatus } from "./useArtifactRun";

const stepLabels: Record<WorkflowStep, string> = {
  RESOLVE_INPUT: "Understanding your brief",
  RESEARCH: "Researching sources",
  GENERATE: "Generating your artifact",
  RENDER_PDF: "Rendering the carousel PDF",
  PERSIST_VERSION: "Saving your artifact",
};

function generationStepLabel(type?: ArtifactType) {
  if (type === "POST") return "Writing your post";
  if (type === "POLL") return "Shaping your poll";
  if (type === "DOCUMENT") return "Building your carousel";
  return stepLabels.GENERATE;
}

function RunStepIcon({ status }: { status: StepStatus }) {
  if (status === "completed") return <Check size={14} strokeWidth={2.4} />;
  if (status === "active" || status === "retrying") return <LoaderCircle size={15} />;
  if (status === "failed") return <XCircle size={15} />;
  return <Circle size={12} />;
}

function currentStepNumber(run: RunState) {
  if (!run.steps.length) return null;

  const currentIndex = run.steps.findIndex(({ status }) =>
    status === "active" || status === "retrying" || status === "failed");
  if (currentIndex >= 0) return currentIndex + 1;

  const pendingIndex = run.steps.findIndex(({ status }) => status === "pending");
  if (pendingIndex >= 0) return pendingIndex + 1;

  return run.steps.length;
}

export default function ArtifactRunProgress({
  run,
  artifactType,
  artifactId,
  onRetryLoad,
}: {
  run: RunState;
  artifactType?: ArtifactType;
  artifactId: string;
  onRetryLoad: () => void;
}) {
  const panelId = useId();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFailureCollapsed, setIsFailureCollapsed] = useState(false);
  const type = run.type ?? artifactType;
  const stepNumber = currentStepNumber(run);
  const totalSteps = run.steps.length;
  const isFailed = run.status === "failed";
  const showDetails = isFailed ? !isFailureCollapsed : isExpanded;
  const retryHref = `/artifacts/new?${new URLSearchParams({
    ...(type ? { type } : {}),
    restore: artifactId,
  }).toString()}`;

  const summary = stepNumber && totalSteps
    ? `Step ${stepNumber}/${totalSteps}`
    : "Starting build";

  return (
    <div
      className={`mq-studio-progress${showDetails ? " is-expanded" : ""}${isFailed ? " is-failed" : ""}`}
      aria-live="polite"
    >
      <button
        type="button"
        className="mq-studio-progress-toggle"
        aria-expanded={showDetails}
        aria-controls={panelId}
        aria-label={`${showDetails ? "Collapse" : "Expand"} artifact build progress, ${summary}`}
        onClick={() => {
          if (isFailed) {
            setIsFailureCollapsed((current) => !current);
          } else {
            setIsExpanded((current) => !current);
          }
        }}
      >
        <span className="mq-studio-progress-state" aria-hidden="true">
          {isFailed ? <XCircle size={16} /> : <LoaderCircle size={16} />}
        </span>
        <strong>{summary}</strong>
        {run.status === "reconnecting"
          ? <small>Reconnecting…</small>
          : run.credits > 0 ? <small>{run.credits} credits</small> : null}
        <ChevronDown className="mq-studio-progress-chevron" size={16} aria-hidden="true" />
      </button>

      <div id={panelId} className="mq-studio-progress-panel" hidden={!showDetails}>
        {run.status === "connecting" && !run.steps.length ? (
          <div className="mq-studio-progress-notice">
            <LoaderCircle size={15} /> Connecting to the run…
          </div>
        ) : null}

        {run.steps.length ? (
          <ol className="mq-studio-run-steps">
            {run.steps.map(({ step, status, message }) => (
              <li key={step} className={`is-${status}`}>
                <span className="mq-studio-step-icon"><RunStepIcon status={status} /></span>
                <span>
                  <strong>{step === "GENERATE" ? generationStepLabel(type) : stepLabels[step]}</strong>
                  {step === "RESEARCH" && typeof run.sourcesFound === "number" ? (
                    <small>{run.sourcesFound} source{run.sourcesFound === 1 ? "" : "s"} found</small>
                  ) : null}
                  {message ? <small>{status === "retrying" ? `Retrying — ${message}` : message}</small> : null}
                </span>
              </li>
            ))}
          </ol>
        ) : null}

        {run.status === "loading-result" ? (
          <div className="mq-studio-progress-notice"><LoaderCircle size={15} /> Preparing your response…</div>
        ) : null}

        {run.status === "reconnecting" ? (
          <div className="mq-studio-progress-notice"><RefreshCw size={14} /> Connection interrupted. Reconnecting…</div>
        ) : null}

        {isFailed ? (
          <div className="mq-studio-run-failure">
            <p>{run.failureReason || "The run stopped before the artifact was ready."}</p>
            {run.failureAction === "retry-create" ? <Link href={retryHref}>Try again</Link> : null}
            {run.failureAction === "retry-load" ? (
              <button type="button" onClick={onRetryLoad}><RefreshCw size={13} /> Load response again</button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
