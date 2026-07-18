"use client";

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
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Trash2,
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
  UpdateArtifactRequest,
} from "./artifactTypes";
import ArtifactDeleteConfirmModal from "./ArtifactDeleteConfirmModal";
import ArtifactResponse, { artifactTypeLabels } from "./ArtifactResponse";
import ArtifactRunProgress from "./ArtifactRunProgress";
import { readArtifactPrompt } from "./artifactStudioStorage";
import {
  API_BASE,
  ApiRequestError,
  deleteArtifactRequest,
  jsonRequest,
  readApi,
} from "./api";
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
  const [isEditing, setIsEditing] = useState(false);
  const [savingVersion, setSavingVersion] = useState<number | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [editResetKey, setEditResetKey] = useState(0);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
      const synchronized = current.map((entry) => entry.role === "assistant"
        ? { ...entry, artifact: { ...entry.artifact, currentVersion: artifact.currentVersion } }
        : entry);
      const existingIndex = synchronized.findIndex((entry) => entry.id === id);
      const existingEntry = existingIndex === -1 ? undefined : synchronized[existingIndex];
      const nextEntry: ConversationEntry = {
        id,
        role: "assistant",
        artifact,
        credits: credits ?? (existingEntry?.role === "assistant" ? existingEntry.credits : undefined),
      };
      if (existingIndex === -1) return [...synchronized, nextEntry];
      const next = [...synchronized];
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
  const canRefine = responses.length > 0
    && !activeRunId
    && !isStartingRefine
    && !isEditing
    && savingVersion === null
    && !isDeleting;

  async function saveArtifact(version: number, request: UpdateArtifactRequest) {
    setSavingVersion(version);
    setEditError(null);
    setConflictError(null);
    try {
      const response = await readApi<ArtifactDetailResponse>(
        `${API_BASE}/artifacts/${encodeURIComponent(artifactId)}`,
        jsonRequest(request, { method: "PATCH" }),
      );
      if (!response?.data) throw new Error("The saved artifact could not be loaded.");
      appendArtifact(response.data);
    } catch (reason) {
      let message = reason instanceof Error ? reason.message : "The artifact could not be saved.";
      if (reason instanceof ApiRequestError && reason.status === 409) {
        setIsEditing(false);
        setEditResetKey((current) => current + 1);
        try {
          const current = await readArtifact(undefined, true);
          setEntries((entries) => entries.map((entry) => entry.role === "assistant"
            ? { ...entry, artifact: { ...entry.artifact, currentVersion: current.currentVersion } }
            : entry));
          if (current.status === "READY") appendArtifact(current);
          message = `${message} The latest version has been loaded.`;
        } catch {
          message = `${message} Reload the page before trying again.`;
        }
        setConflictError(message);
      }
      setEditError(message);
      throw reason;
    } finally {
      setSavingVersion(null);
    }
  }

  async function deleteArtifact() {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteArtifactRequest(artifactId);
      router.replace("/artifacts");
      router.refresh();
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "The artifact could not be deleted.");
      setIsDeleting(false);
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
      title={artifactTitle}
      topbar={{
        back: { href: "/artifacts", label: "Back to artifacts" },
        subtitle: artifactType ? `${artifactTypeLabels[artifactType]} · Created with Mark` : "Creating with Mark",
        credits: { refreshKey: activeRunId },
      }}
      topbarExtra={isHydrated ? (
        <button
          type="button"
          className="mq-artifact-delete-topbar"
          onClick={() => {
            setDeleteError(null);
            setIsDeleteOpen(true);
          }}
          disabled={isDeleting || isEditing || savingVersion !== null || isStartingRefine}
        >
          <Trash2 size={15} /> Delete
        </button>
      ) : null}
      showAccountSelector={false}
    >
      <section className="mq-studio-conversation" aria-label="Artifact conversation">
        <div className="mq-studio-thread">
          {loadError ? (
            <div className="mq-studio-load-error" role="alert">
              <XCircle size={17} />
              <span>{loadError}</span>
              <button type="button" onClick={() => window.location.reload()}><RefreshCw size={13} /> Retry</button>
            </div>
          ) : null}

          {conflictError ? (
            <div className="mq-studio-load-error" role="alert">
              <XCircle size={17} />
              <span>{conflictError}</span>
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
                <ArtifactResponse
                  key={`${entry.id}-${editResetKey}`}
                  artifact={entry.artifact}
                  credits={entry.credits}
                  canEdit={
                    entry.artifact.status === "READY"
                    && entry.artifact.version === entry.artifact.currentVersion
                    && (entry.artifact.type === "POST" || entry.artifact.type === "POLL")
                    && !activeRunId
                    && !isStartingRefine
                    && !isDeleting
                  }
                  isSaving={savingVersion === entry.artifact.version}
                  editError={entry.artifact.version === entry.artifact.currentVersion ? editError : null}
                  onEditingChange={(editing) => {
                    setIsEditing(editing);
                    if (editing) setConflictError(null);
                    setEditError(null);
                  }}
                  onSave={(request) => saveArtifact(entry.artifact.version, request)}
                />
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
                placeholder="Tell Mark what to change…"
                maxLength={2000}
                rows={2}
                disabled={!canRefine}
              />
              <div className="mq-studio-refine-actions">
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
      <ArtifactDeleteConfirmModal
        isOpen={isDeleteOpen}
        isDeleting={isDeleting}
        artifactTitle={artifactTitle === "Artifact Studio" ? undefined : artifactTitle}
        error={deleteError}
        onClose={() => {
          if (isDeleting) return;
          setIsDeleteOpen(false);
          setDeleteError(null);
        }}
        onConfirm={() => void deleteArtifact()}
      />
    </RedesignShell>
  );
}
