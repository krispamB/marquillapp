"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ArtifactRunKind,
  ArtifactType,
  RunCompletedEvent,
  RunFailedEvent,
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
  failureReason?: string;
  failureAction?: "retry-create" | "retry-load";
  retryVersion?: number;
};

type UseArtifactRunOptions = {
  runId?: string;
  enabled: boolean;
  initialType?: ArtifactType;
  onType: (type: ArtifactType) => void;
  onArtifactReady: (version: number, credits: number) => Promise<void>;
  onTerminalFailure: () => void;
};

function updateStep(steps: ProgressStep[], step: WorkflowStep, patch: Partial<ProgressStep>) {
  return steps.map((candidate) => candidate.step === step ? { ...candidate, ...patch } : candidate);
}

export function useArtifactRun({
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

  const loadCompletedVersion = useCallback(async (version: number) => {
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
      await onArtifactReady(version, runCreditsRef.current);
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
    setRun({ status: "connecting", kind, type, steps: [], credits: 0 });
  }, []);

  const clearRun = useCallback(() => setRun(null), []);

  const showDurableFailure = useCallback((type: ArtifactType, kind: ArtifactRunKind) => {
    setRun({
      status: "failed",
      kind,
      type,
      steps: [],
      credits: 0,
      failureReason: "This artifact run failed before completion.",
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
      void loadCompletedVersion(data.version);
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
