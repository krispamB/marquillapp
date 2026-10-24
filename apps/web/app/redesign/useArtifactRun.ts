"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ArtifactContent,
  ArtifactRunKind,
  ArtifactType,
  RunCompletedEvent,
  RunFailedEvent,
  RunFailureCode,
  RunProgressEvent,
  RunStartedEvent,
  RunStepEvent,
  RunStepFailedEvent,
  RunUsageEvent,
  WorkflowStep,
} from "./artifactTypes";
import { API_BASE } from "./api";

export type StepStatus = "pending" | "active" | "completed" | "retrying" | "failed";

export type ProgressStep = {
  step: WorkflowStep;
  status: StepStatus;
  message?: string;
};

export type RunState = {
  status: "connecting" | "running" | "reconnecting" | "loading-result" | "failed";
  kind?: ArtifactRunKind;
  type?: ArtifactType;
  steps: ProgressStep[];
  credits: number;
  sourcesFound?: number;
  failureCode?: RunFailureCode;
  failureReason?: string;
  failureAction?: "retry-create" | "retry-load";
  retryVersion?: number;
};

/** A live `run.completed`'s own copy of the finished version, in place of the follow-up GET. */
export type InlineArtifactResult = {
  artifactId: string;
  type: ArtifactType;
  content: ArtifactContent;
  title?: string;
};

/**
 * A `run.completed` older than this was replayed from the retained stream
 * rather than observed live, so the GET is the source of truth.
 */
const LIVE_COMPLETION_MAX_AGE_MS = 30_000;

function inlineResultOf(
  data: RunCompletedEvent,
  started: { kind: ArtifactRunKind; type: ArtifactType } | null,
  artifactId: string | undefined,
): InlineArtifactResult | undefined {
  if (!started || !artifactId || data.artifactId !== artifactId) return undefined;
  if (started.type !== "POST" && started.type !== "POLL") return undefined;
  if (Date.now() - data.ts > LIVE_COMPLETION_MAX_AGE_MS) return undefined;
  const { content } = data;
  if (!content || typeof content !== "object") return undefined;
  if (started.type === "POST" && typeof content.commentary !== "string") return undefined;
  if (started.type === "POLL" && !content.poll) return undefined;
  const title = data.title?.trim();
  if (started.kind === "INITIAL" && !title) return undefined;
  return { artifactId, type: started.type, content, ...(title ? { title } : {}) };
}

type UseArtifactRunOptions = {
  /** The artifact this page shows; a completion for another artifact never renders inline. */
  artifactId?: string;
  runId?: string;
  enabled: boolean;
  initialType?: ArtifactType;
  onType: (type: ArtifactType) => void;
  /** `inline` is present only for a live POST or POLL completion that carried its content. */
  onArtifactReady: (
    version: number,
    credits: number,
    inline?: InlineArtifactResult,
  ) => Promise<void>;
  onTerminalFailure: () => void;
};

function updateStep(steps: ProgressStep[], step: WorkflowStep, patch: Partial<ProgressStep>) {
  return steps.map((candidate) => candidate.step === step ? { ...candidate, ...patch } : candidate);
}

export function useArtifactRun({
  artifactId,
  runId,
  enabled,
  initialType,
  onType,
  onArtifactReady,
  onTerminalFailure,
}: UseArtifactRunOptions) {
  const [run, setRun] = useState<RunState | null>(runId ? {
    status: "connecting",
    type: initialType,
    steps: [],
    credits: 0,
  } : null);
  const lastSeqRef = useRef(0);
  const runCreditsRef = useRef(0);
  const terminalRef = useRef(false);
  const initialTypeRef = useRef(initialType);
  initialTypeRef.current = initialType;
  const artifactIdRef = useRef(artifactId);
  artifactIdRef.current = artifactId;
  const startedRef = useRef<{ kind: ArtifactRunKind; type: ArtifactType } | null>(null);

  const loadCompletedVersion = useCallback(async (version: number, inline?: InlineArtifactResult) => {
    setRun((current) => current ? {
      ...current,
      status: "loading-result",
      failureReason: undefined,
      failureAction: undefined,
      retryVersion: version,
    } : {
      status: "loading-result",
      type: initialTypeRef.current,
      steps: [],
      credits: runCreditsRef.current,
      retryVersion: version,
    });

    try {
      try {
        await onArtifactReady(version, runCreditsRef.current, inline);
      } catch (reason) {
        // The inline copy could not be shown; the GET is the fallback.
        if (!inline) throw reason;
        await onArtifactReady(version, runCreditsRef.current);
      }
      setRun(null);
    } catch (reason) {
      setRun((current) => ({
        status: "failed",
        kind: current?.kind,
        type: current?.type ?? initialTypeRef.current,
        steps: current?.steps ?? [],
        credits: current?.credits ?? runCreditsRef.current,
        failureReason: reason instanceof Error
          ? `The artifact finished, but its response could not be loaded: ${reason.message}`
          : "The artifact finished, but its response could not be loaded.",
        failureAction: "retry-load",
        retryVersion: version,
      }));
    }
  }, [onArtifactReady]);

  const beginRun = useCallback((kind: ArtifactRunKind, type?: ArtifactType) => {
    lastSeqRef.current = 0;
    runCreditsRef.current = 0;
    terminalRef.current = false;
    startedRef.current = null;
    setRun({ status: "connecting", kind, type, steps: [], credits: 0 });
  }, []);

  const clearRun = useCallback(() => setRun(null), []);

  const showDurableFailure = useCallback((
    type: ArtifactType,
    kind: ArtifactRunKind,
    failureCode?: RunFailureCode,
    failureReason?: string,
  ) => {
    setRun({
      status: "failed",
      kind,
      type,
      steps: [],
      credits: 0,
      failureCode,
      failureReason: failureReason || "This artifact run failed before completion.",
      failureAction: kind === "INITIAL" ? "retry-create" : undefined,
    });
  }, []);

  const retryCompletedVersion = useCallback(() => {
    if (run?.retryVersion) void loadCompletedVersion(run.retryVersion);
  }, [loadCompletedVersion, run?.retryVersion]);

  useEffect(() => {
    if (!enabled || !runId) return;

    lastSeqRef.current = 0;
    runCreditsRef.current = 0;
    terminalRef.current = false;
    startedRef.current = null;
    const events = new EventSource(
      `${API_BASE}/runs/${encodeURIComponent(runId)}/events`,
      { withCredentials: true },
    );

    const accept = <T extends { seq: number }>(event: MessageEvent<string>): T | null => {
      try {
        const data = JSON.parse(event.data) as T;
        if (!Number.isFinite(data.seq) || data.seq <= lastSeqRef.current) return null;
        lastSeqRef.current = data.seq;
        return data;
      } catch {
        return null;
      }
    };

    events.onopen = () => {
      setRun((current) => current ? { ...current, status: "running" } : {
        status: "running",
        type: initialTypeRef.current,
        steps: [],
        credits: 0,
      });
    };

    const onStarted = (event: Event) => {
      const data = accept<RunStartedEvent>(event as MessageEvent<string>);
      if (!data) return;
      onType(data.type);
      startedRef.current = { kind: data.kind, type: data.type };
      runCreditsRef.current = 0;
      setRun({
        status: "running",
        kind: data.kind,
        type: data.type,
        steps: data.steps.map((step) => ({ step, status: "pending" })),
        credits: 0,
      });
    };

    const onStepStarted = (event: Event) => {
      const data = accept<RunStepEvent>(event as MessageEvent<string>);
      if (!data) return;
      setRun((current) => current ? {
        ...current,
        status: "running",
        steps: updateStep(current.steps, data.step, { status: "active", message: undefined }),
      } : current);
    };

    const onStepCompleted = (event: Event) => {
      const data = accept<RunStepEvent>(event as MessageEvent<string>);
      if (!data) return;
      setRun((current) => current ? {
        ...current,
        steps: updateStep(current.steps, data.step, { status: "completed", message: undefined }),
      } : current);
    };

    const onStepProgress = (event: Event) => {
      const data = accept<RunProgressEvent>(event as MessageEvent<string>);
      if (data?.step === "RESEARCH" && typeof data.sourcesFound === "number") {
        setRun((current) => current ? { ...current, sourcesFound: data.sourcesFound } : current);
      }
    };

    const onUsage = (event: Event) => {
      const data = accept<RunUsageEvent>(event as MessageEvent<string>);
      if (!data) return;
      runCreditsRef.current = data.totalCredits;
      setRun((current) => current ? { ...current, credits: data.totalCredits } : current);
    };

    const onStepFailed = (event: Event) => {
      const data = accept<RunStepFailedEvent>(event as MessageEvent<string>);
      if (!data) return;
      setRun((current) => current ? {
        ...current,
        steps: updateStep(current.steps, data.step, {
          status: data.retryable ? "retrying" : "failed",
          message: data.message,
        }),
      } : current);
    };

    const onCompleted = (event: Event) => {
      const data = accept<RunCompletedEvent>(event as MessageEvent<string>);
      if (!data) return;
      terminalRef.current = true;
      events.close();
      void loadCompletedVersion(
        data.version,
        inlineResultOf(data, startedRef.current, artifactIdRef.current),
      );
    };

    const onFailed = (event: Event) => {
      const data = accept<RunFailedEvent>(event as MessageEvent<string>);
      if (!data) return;
      terminalRef.current = true;
      events.close();
      setRun((current) => ({
        status: "failed",
        kind: current?.kind,
        type: current?.type ?? initialTypeRef.current,
        steps: current?.steps ?? [],
        credits: current?.credits ?? 0,
        failureCode: data.code,
        failureReason: data.failureReason,
        failureAction: current?.kind === "REFINE" ? undefined : "retry-create",
      }));
      onTerminalFailure();
    };

    events.addEventListener("run.started", onStarted);
    events.addEventListener("step.started", onStepStarted);
    events.addEventListener("step.completed", onStepCompleted);
    events.addEventListener("step.progress", onStepProgress);
    events.addEventListener("usage.tick", onUsage);
    events.addEventListener("step.failed", onStepFailed);
    events.addEventListener("run.completed", onCompleted);
    events.addEventListener("run.failed", onFailed);
    events.onerror = () => {
      if (!terminalRef.current) {
        setRun((current) => current ? { ...current, status: "reconnecting" } : current);
      }
    };

    return () => events.close();
  }, [enabled, loadCompletedVersion, onTerminalFailure, onType, runId]);

  return {
    run,
    beginRun,
    clearRun,
    retryCompletedVersion,
    showDurableFailure,
  };
}
