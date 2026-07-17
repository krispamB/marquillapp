"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  ArrowUp,
  BarChart3,
  Check,
  Circle,
  Coins,
  ExternalLink,
  FileText,
  GalleryHorizontal,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Sparkles,
  XCircle,
} from "lucide-react";
import MarquillMark from "../../components/brand/MarquillMark";
import type {
  ConnectedAccount,
  SubscriptionTier,
  UserProfile,
} from "../lib/types";
import type {
  ArtifactDetailData,
  ArtifactDetailResponse,
  ArtifactRunKind,
  ArtifactType,
  RefineArtifactResponse,
  RunCompletedEvent,
  RunFailedEvent,
  RunProgressEvent,
  RunStartedEvent,
  RunStepEvent,
  RunStepFailedEvent,
  RunUsageEvent,
  WorkflowStep,
} from "./artifactTypes";
import { API_BASE, jsonRequest, readApi } from "./api";
import RedesignShell from "./Shell";

type StepStatus = "pending" | "active" | "completed" | "retrying" | "failed";

type ProgressStep = {
  step: WorkflowStep;
  status: StepStatus;
  message?: string;
};

type RunState = {
  status: "connecting" | "running" | "reconnecting" | "loading-result" | "failed";
  kind?: ArtifactRunKind;
  type?: ArtifactType;
  steps: ProgressStep[];
  credits: number;
  sourcesFound?: number;
  usageKind?: RunUsageEvent["kind"];
  failureReason?: string;
  failureAction?: "retry-create" | "retry-load";
  retryVersion?: number;
};

type ConversationEntry =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; artifact: ArtifactDetailData; credits?: number };

const typeLabels: Record<ArtifactType, string> = {
  POST: "Post",
  POLL: "Poll",
  DOCUMENT: "Carousel",
};

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

function updateStep(
  steps: ProgressStep[],
  step: WorkflowStep,
  patch: Partial<ProgressStep>,
) {
  return steps.map((candidate) => candidate.step === step ? { ...candidate, ...patch } : candidate);
}

function RunStepIcon({ status }: { status: StepStatus }) {
  if (status === "completed") return <Check size={14} />;
  if (status === "active" || status === "retrying") return <LoaderCircle size={15} />;
  if (status === "failed") return <XCircle size={15} />;
  return <Circle size={14} />;
}

function ArtifactResponse({
  artifact,
  credits,
}: {
  artifact: ArtifactDetailData;
  credits?: number;
}) {
  const isEditableType = artifact.type === "POST" || artifact.type === "POLL";
  const commentary = artifact.content.commentary?.trim();
  const poll = artifact.content.poll;
  const document = artifact.content.document;
  const TypeIcon = artifact.type === "POST"
    ? FileText
    : artifact.type === "POLL"
      ? BarChart3
      : GalleryHorizontal;

  return (
    <article className="mq-studio-response">
      <header className="mq-studio-response-head">
        <div className="mq-studio-response-labels">
          <span className={`mq-artifact-type mq-artifact-type-${artifact.type.toLowerCase()}`}>
            <TypeIcon size={13} /> {typeLabels[artifact.type]}
          </span>
          <span className="mq-studio-version">v{artifact.version}</span>
        </div>
        {isEditableType ? (
          <button type="button" className="mq-studio-edit" disabled title="Artifact editing is coming next">
            <Pencil size={14} /> Edit
          </button>
        ) : null}
      </header>

      <div className="mq-studio-response-body">
        {artifact.type === "POST" ? (
          <div className="mq-studio-post-copy">{commentary || "No post copy was returned."}</div>
        ) : null}

        {artifact.type === "POLL" ? (
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
            {poll ? (
              <small>Open for {poll.durationDays} day{poll.durationDays === 1 ? "" : "s"}</small>
            ) : null}
          </div>
        ) : null}

        {artifact.type === "DOCUMENT" ? (
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
        ) : null}
      </div>

      <footer className="mq-studio-response-foot">
        <span>Created by Mark</span>
        {typeof credits === "number" && credits > 0 ? <span><Coins size={13} /> {credits} credits</span> : null}
      </footer>
    </article>
  );
}

function RunProgress({
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
                  : `Mark is building your ${type ? typeLabels[type].toLowerCase() : "artifact"}`}
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

export default function ArtifactConversationClient({
  user,
  connectedAccounts,
  primaryAccountId,
  subscription,
  artifactId,
  initialRunId,
}: {
  user: UserProfile;
  connectedAccounts: ConnectedAccount[];
  primaryAccountId?: string;
  subscription?: SubscriptionTier | null;
  artifactId: string;
  initialRunId?: string;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [artifactType, setArtifactType] = useState<ArtifactType>();
  const [artifactTitle, setArtifactTitle] = useState("Artifact Studio");
  const [activeRunId, setActiveRunId] = useState(initialRunId);
  const [run, setRun] = useState<RunState | null>(initialRunId ? {
    status: "connecting",
    steps: [],
    credits: 0,
  } : null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isStartingRefine, setIsStartingRefine] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const lastSeqRef = useRef(0);
  const runCreditsRef = useRef(0);
  const terminalRef = useRef(false);

  const cleanArtifactUrl = `/artifacts/${encodeURIComponent(artifactId)}`;

  const appendUser = useCallback((text: string, id: string) => {
    setEntries((current) => current.some((entry) => entry.id === id)
      ? current
      : [...current, { id, role: "user", text }]);
  }, []);

  const appendArtifact = useCallback((artifact: ArtifactDetailData, credits?: number) => {
    setArtifactType(artifact.type);
    if (artifact.title?.trim()) setArtifactTitle(artifact.title.trim());
    setEntries((current) => {
      const id = `version-${artifact.version}`;
      const existingIndex = current.findIndex((entry) => entry.id === id);
      const nextEntry: ConversationEntry = { id, role: "assistant", artifact, credits };
      if (existingIndex === -1) return [...current, nextEntry];
      const next = [...current];
      next[existingIndex] = nextEntry;
      return next;
    });
  }, []);

  const readArtifact = useCallback(async (version?: number, includeVersions = false) => {
    const query = new URLSearchParams();
    if (typeof version === "number") query.set("version", String(version));
    if (includeVersions) query.set("includeVersions", "true");
    const suffix = query.size ? `?${query.toString()}` : "";
    const response = await readApi<ArtifactDetailResponse>(
      `${API_BASE}/artifacts/${encodeURIComponent(artifactId)}${suffix}`,
    );
    if (!response?.data) throw new Error("The artifact could not be loaded.");
    return response.data;
  }, [artifactId]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateConversation() {
      setLoadError(null);
      const storedPrompt = window.sessionStorage.getItem(`marquill:artifact:${artifactId}:prompt`);
      if (storedPrompt) appendUser(storedPrompt, "initial-prompt");

      try {
        const detail = await readArtifact(undefined, true);
        if (cancelled) return;
        setArtifactType(detail.type);
        if (detail.title?.trim()) setArtifactTitle(detail.title.trim());

        if (detail.status === "READY") {
          appendArtifact(detail);
          setActiveRunId(undefined);
          setRun(null);
          if (initialRunId) router.replace(cleanArtifactUrl);
        } else {
          const readyVersions = (detail.versions ?? [])
            .filter((version) => version.status === "READY")
            .sort((left, right) => right.version - left.version);
          if (readyVersions[0]) {
            const previous = await readArtifact(readyVersions[0].version);
            if (!cancelled) appendArtifact(previous);
          }
          const currentVersion = detail.versions?.find((version) => version.version === detail.currentVersion);
          if (currentVersion?.refineFeedback) {
            appendUser(currentVersion.refineFeedback, `feedback-${detail.currentVersion}`);
          }
          if (!initialRunId && detail.status === "FAILED") {
            setRun({
              status: "failed",
              kind: readyVersions.length ? "REFINE" : "INITIAL",
              type: detail.type,
              steps: [],
              credits: 0,
              failureReason: "This artifact run failed before completion.",
              failureAction: readyVersions.length ? undefined : "retry-create",
            });
          }
        }
      } catch (reason) {
        if (!cancelled) {
          setLoadError(reason instanceof Error ? reason.message : "The artifact could not be loaded.");
        }
      } finally {
        if (!cancelled) setIsHydrated(true);
      }
    }

    void hydrateConversation();
    return () => { cancelled = true; };
  }, [appendArtifact, appendUser, artifactId, cleanArtifactUrl, initialRunId, readArtifact, router]);

  useEffect(() => {
    if (!isHydrated || !activeRunId) return;

    lastSeqRef.current = 0;
    runCreditsRef.current = 0;
    terminalRef.current = false;
    const events = new EventSource(
      `${API_BASE}/runs/${encodeURIComponent(activeRunId)}/events`,
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
        steps: [],
        credits: 0,
      });
    };

    const onStarted = (event: Event) => {
      const data = accept<RunStartedEvent>(event as MessageEvent<string>);
      if (!data) return;
      setArtifactType(data.type);
      setRun({
        status: "running",
        kind: data.kind,
        type: data.type,
        steps: data.steps.map((step) => ({ step, status: "pending" })),
        credits: 0,
      });
      runCreditsRef.current = 0;
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
      if (!data) return;
      if (data.step === "RESEARCH" && typeof data.sourcesFound === "number") {
        setRun((current) => current ? { ...current, sourcesFound: data.sourcesFound } : current);
      }
    };

    const onUsage = (event: Event) => {
      const data = accept<RunUsageEvent>(event as MessageEvent<string>);
      if (!data) return;
      runCreditsRef.current = data.totalCredits;
      setRun((current) => current ? {
        ...current,
        credits: data.totalCredits,
        usageKind: data.kind,
      } : current);
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
      setRun((current) => current ? { ...current, status: "loading-result" } : current);
      void readArtifact(data.version)
        .then((artifact) => {
          appendArtifact(artifact, runCreditsRef.current);
          setLoadError(null);
          setRun(null);
          setActiveRunId(undefined);
          router.replace(cleanArtifactUrl);
        })
        .catch((reason) => {
          setRun((current) => ({
            status: "failed",
            kind: current?.kind,
            type: current?.type,
            steps: current?.steps ?? [],
            credits: current?.credits ?? 0,
            failureReason: reason instanceof Error
              ? `The artifact finished, but its response could not be loaded: ${reason.message}`
              : "The artifact finished, but its response could not be loaded.",
            failureAction: "retry-load",
            retryVersion: data.version,
          }));
          setActiveRunId(undefined);
          router.replace(cleanArtifactUrl);
        });
    };

    const onFailed = (event: Event) => {
      const data = accept<RunFailedEvent>(event as MessageEvent<string>);
      if (!data) return;
      terminalRef.current = true;
      events.close();
      setRun((current) => ({
        status: "failed",
        kind: current?.kind,
        type: current?.type,
        steps: current?.steps ?? [],
        credits: current?.credits ?? 0,
        failureReason: data.failureReason,
        failureAction: current?.kind === "REFINE" ? undefined : "retry-create",
      }));
      setActiveRunId(undefined);
      router.replace(cleanArtifactUrl);
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
  }, [activeRunId, appendArtifact, cleanArtifactUrl, isHydrated, readArtifact, router]);

  const responses = useMemo(
    () => entries.filter((entry): entry is Extract<ConversationEntry, { role: "assistant" }> => entry.role === "assistant"),
    [entries],
  );
  const canRefine = responses.length > 0 && !activeRunId && !isStartingRefine;

  async function retryCompletedArtifact() {
    if (!run?.retryVersion) return;
    const retryVersion = run.retryVersion;
    const previousRun = run;
    setRun({ ...run, status: "loading-result", failureReason: undefined, failureAction: undefined });
    try {
      const artifact = await readArtifact(retryVersion);
      appendArtifact(artifact, previousRun.credits);
      setLoadError(null);
      setRun(null);
    } catch (reason) {
      setRun({
        ...previousRun,
        status: "failed",
        failureReason: reason instanceof Error
          ? `The artifact is ready, but its response still could not be loaded: ${reason.message}`
          : "The artifact is ready, but its response still could not be loaded.",
        failureAction: "retry-load",
        retryVersion,
      });
    }
  }

  async function startRefinement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedFeedback = feedback.trim();
    if (!trimmedFeedback || !canRefine) return;
    setRefineError(null);
    setIsStartingRefine(true);
    try {
      const response = await readApi<RefineArtifactResponse>(
        `${API_BASE}/artifacts/${encodeURIComponent(artifactId)}/refine`,
        jsonRequest({ feedback: trimmedFeedback }, { method: "POST" }),
      );
      if (!response?.runId || typeof response.version !== "number") {
        throw new Error("The refinement run could not be started.");
      }
      appendUser(trimmedFeedback, `feedback-${response.version}`);
      setFeedback("");
      setRun({ status: "connecting", kind: "REFINE", type: artifactType, steps: [], credits: 0 });
      setActiveRunId(response.runId);
      router.replace(`${cleanArtifactUrl}?run=${encodeURIComponent(response.runId)}`);
    } catch (reason) {
      setRefineError(reason instanceof Error ? reason.message : "The refinement run could not be started.");
    } finally {
      setIsStartingRefine(false);
    }
  }

  return (
    <RedesignShell
      user={user}
      accounts={connectedAccounts}
      selectedAccountId={primaryAccountId}
      subscription={subscription}
      active="artifacts"
      title="Artifact Studio"
      showAccountSelector={false}
    >
      <section className="mq-studio-conversation" aria-label="Artifact conversation">
        <header className="mq-studio-conversation-head">
          <Link href="/artifacts" aria-label="Back to artifacts"><ArrowLeft size={18} /></Link>
          <div>
            <h1>{artifactTitle}</h1>
            <p>{artifactType ? `${typeLabels[artifactType]} · Created with Mark` : "Creating with Mark"}</p>
          </div>
        </header>

        <div className="mq-studio-thread">
          {loadError ? (
            <div className="mq-studio-load-error" role="alert">
              <XCircle size={17} />
              <span>{loadError}</span>
              <button type="button" onClick={() => window.location.reload()}><RefreshCw size={13} /> Retry</button>
            </div>
          ) : null}

          {!isHydrated && !entries.length ? (
            <div className="mq-studio-thread-loading"><LoaderCircle size={18} /> Loading artifact…</div>
          ) : null}

          {entries.map((entry) => entry.role === "user" ? (
            <div className="mq-studio-user-message" key={entry.id}>{entry.text}</div>
          ) : (
            <div className="mq-studio-assistant-message" key={entry.id}>
              <div className="mq-studio-mark"><MarquillMark size={30} theme="auto" title="Mark" /></div>
              <div className="mq-studio-assistant-content">
                <div className="mq-studio-assistant-meta">Mark created version {entry.artifact.version}</div>
                <ArtifactResponse artifact={entry.artifact} credits={entry.credits} />
              </div>
            </div>
          ))}

          {run ? (
            <RunProgress
              run={run}
              artifactType={artifactType}
              artifactId={artifactId}
              onRetryLoad={() => { void retryCompletedArtifact(); }}
            />
          ) : null}
        </div>

        {responses.length ? (
          <div className="mq-studio-refine-wrap">
            <form className="mq-studio-refine" onSubmit={startRefinement}>
              <label htmlFor="artifact-feedback" className="sr-only">Reply to refine the artifact</label>
              <textarea
                id="artifact-feedback"
                value={feedback}
                onChange={(event) => {
                  setFeedback(event.target.value);
                  if (refineError) setRefineError(null);
                }}
                placeholder="Reply to refine — anything you say rebuilds the artifact…"
                maxLength={2000}
                rows={2}
                disabled={!canRefine}
              />
              <div className="mq-studio-refine-actions">
                <span>{feedback.length.toLocaleString()} / 2,000</span>
                <button
                  type="submit"
                  disabled={!canRefine || !feedback.trim()}
                  aria-label="Refine artifact"
                >
                  {isStartingRefine || activeRunId ? <LoaderCircle size={17} /> : <><Sparkles size={16} /> Refine</>}
                </button>
              </div>
            </form>
            {refineError ? <p className="mq-studio-refine-error" role="alert">{refineError}</p> : null}
            <p className="mq-studio-refine-note">Every reply creates a new version of this artifact.</p>
          </div>
        ) : null}
      </section>
    </RedesignShell>
  );
}
