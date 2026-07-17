"use client";

import Link from "next/link";
import {
  ArrowUp,
  Check,
  Circle,
  Coins,
  LoaderCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import MarquillMark from "../../components/brand/MarquillMark";
import type { ArtifactType, WorkflowStep } from "./artifactTypes";
import { artifactTypeLabels } from "./ArtifactResponse";
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
  if (status === "completed") return <Check size={14} />;
  if (status === "active" || status === "retrying") return <LoaderCircle size={15} />;
  if (status === "failed") return <XCircle size={15} />;
  return <Circle size={14} />;
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
  const type = run.type ?? artifactType;
  const retryHref = `/artifacts/new?${new URLSearchParams({
    ...(type ? { type } : {}),
    restore: artifactId,
  }).toString()}`;

  return (
    <div className={`mq-studio-run${run.status === "failed" ? " is-failed" : ""}`} aria-live="polite">
      <div className="mq-studio-mark"><MarquillMark size={30} theme="auto" title="Mark" /></div>
      <div className="mq-studio-run-content">
        <div className="mq-studio-run-heading">
          <strong>
            {run.status === "failed"
              ? run.kind === "REFINE" ? "Mark couldn't complete that refinement" : "Mark couldn't build this artifact"
              : run.status === "loading-result"
                ? "Preparing your response"
                : run.kind === "REFINE"
                  ? "Mark is refining your artifact"
                  : `Mark is building your ${type ? artifactTypeLabels[type].toLowerCase() : "artifact"}`}
          </strong>
          {run.credits > 0 ? <span><Coins size={13} /> {run.credits} credits</span> : null}
        </div>

        {run.status === "connecting" && !run.steps.length ? (
          <div className="mq-studio-connecting"><LoaderCircle size={15} /> Connecting to the run…</div>
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

        {run.status === "reconnecting" ? (
          <div className="mq-studio-reconnecting"><RefreshCw size={13} /> Connection interrupted. Reconnecting…</div>
        ) : null}

        {run.status === "failed" ? (
          <div className="mq-studio-run-failure">
            <p>{run.failureReason || "The run stopped before the artifact was ready."}</p>
            {run.failureAction === "retry-create" ? <Link href={retryHref}>Try again <ArrowUp size={14} /></Link> : null}
            {run.failureAction === "retry-load" ? (
              <button type="button" onClick={onRetryLoad}><RefreshCw size={13} /> Load response again</button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
