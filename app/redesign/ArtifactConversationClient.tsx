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
  LoaderCircle,
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
  ArtifactType,
  RefineArtifactResponse,
} from "./artifactTypes";
import ArtifactResponse, { artifactTypeLabels } from "./ArtifactResponse";
import ArtifactRunProgress from "./ArtifactRunProgress";
import { readArtifactPrompt } from "./artifactStudioStorage";
import { API_BASE, jsonRequest, readApi } from "./api";
import RedesignShell from "./Shell";
import { useArtifactRun } from "./useArtifactRun";

type ConversationEntry =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; artifact: ArtifactDetailData; credits?: number };

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
  const initialRunIdRef = useRef(initialRunId);
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [artifactType, setArtifactType] = useState<ArtifactType>();
  const [artifactTitle, setArtifactTitle] = useState("Artifact Studio");
  const [activeRunId, setActiveRunId] = useState(initialRunId);
  const [isHydrated, setIsHydrated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isStartingRefine, setIsStartingRefine] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
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

  const handleArtifactReady = useCallback(async (version: number, credits: number) => {
    try {
      const artifact = await readArtifact(version);
      appendArtifact(artifact, credits);
      setLoadError(null);
    } finally {
      setActiveRunId(undefined);
      router.replace(cleanArtifactUrl);
    }
  }, [appendArtifact, cleanArtifactUrl, readArtifact, router]);

  const handleTerminalFailure = useCallback(() => {
    // Keep ?run= in the URL so refresh can replay the retained terminal reason.
    setActiveRunId(undefined);
  }, []);

  const {
    run,
    beginRun,
    clearRun,
    retryCompletedVersion,
    showDurableFailure,
  } = useArtifactRun({
    runId: activeRunId,
    enabled: isHydrated,
    initialType: artifactType,
    onType: setArtifactType,
    onArtifactReady: handleArtifactReady,
    onTerminalFailure: handleTerminalFailure,
  });

  useEffect(() => {
    let cancelled = false;

    async function hydrateConversation() {
      setLoadError(null);
      const storedPrompt = readArtifactPrompt(artifactId);
      if (storedPrompt) appendUser(storedPrompt, "initial-prompt");

      try {
        const detail = await readArtifact(undefined, true);
        if (cancelled) return;
        setArtifactType(detail.type);
        if (detail.title?.trim()) setArtifactTitle(detail.title.trim());

        if (detail.status === "READY") {
          appendArtifact(detail);
          setActiveRunId(undefined);
          clearRun();
          if (initialRunIdRef.current) router.replace(cleanArtifactUrl);
          return;
        }

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
        if (!initialRunIdRef.current && detail.status === "FAILED") {
          showDurableFailure(detail.type, readyVersions.length ? "REFINE" : "INITIAL");
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
  }, [
    appendArtifact,
    appendUser,
    artifactId,
    cleanArtifactUrl,
    clearRun,
    readArtifact,
    router,
    showDurableFailure,
  ]);

  const responses = useMemo(
    () => entries.filter((entry): entry is Extract<ConversationEntry, { role: "assistant" }> => entry.role === "assistant"),
    [entries],
  );
  const canRefine = responses.length > 0 && !activeRunId && !isStartingRefine;

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
      beginRun("REFINE", artifactType);
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
            <p>{artifactType ? `${artifactTypeLabels[artifactType]} · Created with Mark` : "Creating with Mark"}</p>
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
            <ArtifactRunProgress
              run={run}
              artifactType={artifactType}
              artifactId={artifactId}
              onRetryLoad={retryCompletedVersion}
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
