"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ChevronDown,
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
  UpdateArtifactRequest,
} from "./artifactTypes";
import ArtifactDeleteConfirmModal from "./ArtifactDeleteConfirmModal";
import ArtifactResponse, {
  artifactTypeLabels,
  isAttachableArtifact,
} from "./ArtifactResponse";
import { artifactTypeIcons } from "./artifactPresentation";
import StudioOverflowMenu from "./StudioOverflowMenu";
import ArtifactRunProgress from "./ArtifactRunProgress";
import ConnectedAccountPicker, {
  resolveAttachAccountChoice,
} from "./ConnectedAccountPicker";
import { readArtifactPrompt } from "./artifactStudioStorage";
import { latestAttemptFeedback, resumeLatestAttempt } from "./artifactAttempt";
import {
  API_BASE,
  ApiRequestError,
  deleteArtifactRequest,
  jsonRequest,
  readApi,
} from "./api";
import { refineArtifactBody, refineArtifactRequest } from "./artifactRequests";
import { KEEP_DESIGN_SYSTEM } from "./DesignSystemMenu";
import RefineDesignControl from "./RefineDesignControl";
import { isDesignSystemUnavailable } from "./designSystems";
import useDesignSystems from "./useDesignSystems";
import RedesignShell from "./Shell";
import { useArtifactRun, type InlineArtifactResult } from "./useArtifactRun";
import useArtifactPostDraft from "./useArtifactPostDraft";

type ConversationEntry =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; artifact: ArtifactDetailData; credits?: number };

const REFINE_TEXTAREA_MAX_HEIGHT = 168;

/**
 * Drops `?run=` from the address bar without a Next.js navigation, so the page
 * neither re-renders on the server nor remounts. The App Router syncs its own
 * URL state from `history.replaceState`.
 */
function replaceUrlWithoutNavigation(url: string) {
  window.history.replaceState(window.history.state, "", url);
}

function prefersReducedMotion() {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** An earlier version, folded to one row so the thread stays short and its PDF is not loaded. */
function CollapsedVersion({
  artifact,
  onExpand,
}: {
  artifact: ArtifactDetailData;
  onExpand: () => void;
}) {
  const TypeIcon = artifactTypeIcons[artifact.type];
  const summary = artifact.content.commentary?.trim() || artifact.content.poll?.question;

  return (
    <button type="button" className="mq-studio-collapsed-version" onClick={onExpand} aria-expanded={false}>
      <span className="mq-studio-collapsed-icon"><TypeIcon size={15} /></span>
      <span className="mq-studio-collapsed-copy">
        <strong>{artifact.title?.trim() || artifactTypeLabels[artifact.type]}</strong>
        {summary ? <small>{summary}</small> : null}
      </span>
      <span className="mq-studio-collapsed-action">Show <ChevronDown size={14} /></span>
    </button>
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
  const initialRunIdRef = useRef(initialRunId);
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [artifactType, setArtifactType] = useState<ArtifactType>();
  const [artifactTitle, setArtifactTitle] = useState<string>();
  const artifactTitleRef = useRef(artifactTitle);
  useEffect(() => { artifactTitleRef.current = artifactTitle; }, [artifactTitle]);
  const [activeRunId, setActiveRunId] = useState(initialRunId);
  const [isHydrated, setIsHydrated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isStartingRefine, setIsStartingRefine] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  // "" keeps the Current Version's Design System; a slug switches to it.
  const [refineDesignSystemId, setRefineDesignSystemId] = useState(KEEP_DESIGN_SYSTEM);
  // Set by a 409 `design_system.unavailable`: the refinement cannot keep its design.
  const [designUnavailableMessage, setDesignUnavailableMessage] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [savingVersion, setSavingVersion] = useState<number | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [editResetKey, setEditResetKey] = useState(0);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [attachTarget, setAttachTarget] = useState<ArtifactDetailData | null>(null);
  const [isAccountPickerOpen, setIsAccountPickerOpen] = useState(false);
  // Earlier versions the user unfolded; every other non-current version stays collapsed.
  const [expandedVersions, setExpandedVersions] = useState<ReadonlySet<number>>(() => new Set());
  const entryRefs = useRef(new Map<string, HTMLElement>());
  const seenEntryIds = useRef<Set<string> | null>(null);
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const {
    clearError: clearAttachError,
    createDraft,
    error: attachError,
    isCreating: isAttaching,
  } = useArtifactPostDraft();
  const cleanArtifactUrl = `/artifacts/${encodeURIComponent(artifactId)}`;
  const attachAccountChoice = useMemo(
    () => resolveAttachAccountChoice(connectedAccounts),
    [connectedAccounts],
  );
  const attachableAccounts = attachAccountChoice.accounts;

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
      const synchronized: ConversationEntry[] = current.map((entry) => entry.role === "assistant"
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

  const handleArtifactReady = useCallback(async (
    version: number,
    credits: number,
    inline?: InlineArtifactResult,
  ) => {
    try {
      // A live POST/POLL completion carries the version itself; otherwise read it.
      const artifact: ArtifactDetailData = inline ? {
        id: inline.artifactId,
        type: inline.type,
        title: inline.title ?? artifactTitleRef.current,
        currentVersion: version,
        version,
        status: "READY",
        content: inline.content,
        updatedAt: new Date().toISOString(),
      } : await readArtifact(version);
      appendArtifact(artifact, credits);
      setLoadError(null);
    } finally {
      setActiveRunId(undefined);
      replaceUrlWithoutNavigation(cleanArtifactUrl);
    }
  }, [appendArtifact, cleanArtifactUrl, readArtifact]);

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
    artifactId,
    runId: activeRunId,
    // Follow a ?run= from the first render; the hook does nothing without a run id.
    enabled: true,
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

        // Without ?version= the detail is the Current Version, or the latest
        // Attempt while there is none. An Attempt newer than the Current
        // Version (in flight or failed) is reported beside it.
        if (detail.status === "READY") appendArtifact(detail);

        const attempt = detail.latestAttempt;
        if (!attempt) {
          setActiveRunId(undefined);
          clearRun();
          if (initialRunIdRef.current) replaceUrlWithoutNavigation(cleanArtifactUrl);
          return;
        }

        const feedback = latestAttemptFeedback(detail);
        if (feedback) appendUser(feedback, `feedback-${attempt.version}`);

        const resumption = resumeLatestAttempt(detail, Boolean(initialRunIdRef.current));
        if (resumption.action === "follow") {
          beginRun(resumption.kind, detail.type);
          setActiveRunId(resumption.runId);
        } else if (resumption.action === "show-failure") {
          showDurableFailure(
            detail.type,
            resumption.kind,
            resumption.failureCode,
            resumption.failureReason,
          );
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
    beginRun,
    cleanArtifactUrl,
    clearRun,
    readArtifact,
    showDurableFailure,
  ]);

  const responses = useMemo(
    () => entries.filter((entry): entry is Extract<ConversationEntry, { role: "assistant" }> => entry.role === "assistant"),
    [entries],
  );
  // Bring each new message into view: the user's reply when it is sent, and the
  // top of a new version when it arrives (a carousel is taller than the screen,
  // so scrolling to the bottom would land past its first slide).
  useEffect(() => {
    if (!isHydrated) return;
    const ids = entries.map((entry) => entry.id);
    const seen = seenEntryIds.current;
    seenEntryIds.current = new Set(ids);

    let target: string | undefined;
    if (seen === null) {
      // On load, follow a refinement that is still building; otherwise stay at the top.
      const last = entries.at(-1);
      if (last?.role === "user" && entries.some((entry) => entry.role === "assistant")) target = last.id;
    } else {
      target = ids.findLast((id) => !seen.has(id));
    }
    if (!target) return;

    const node = entryRefs.current.get(target);
    if (!node) return;
    const behavior: ScrollBehavior = seen === null || prefersReducedMotion() ? "auto" : "smooth";
    requestAnimationFrame(() => node.scrollIntoView({ behavior, block: "start" }));
  }, [entries, isHydrated]);

  const canRefine = responses.length > 0
    && !activeRunId
    && !isStartingRefine
    && !isEditing
    && savingVersion === null
    && !isDeleting
    && !isAttaching;

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

  function requestAttach(artifact: ArtifactDetailData) {
    if (isAttaching) return;
    clearAttachError();
    setAttachTarget(artifact);
    if (attachAccountChoice.kind === "single") {
      void createDraft(artifact, attachAccountChoice.account.id);
      return;
    }
    setIsAccountPickerOpen(true);
  }

  const isDocument = artifactType === "DOCUMENT";
  const designSystems = useDesignSystems(isHydrated && isDocument);
  const currentDesignName = responses
    .findLast((entry) => entry.artifact.version === entry.artifact.currentVersion)
    ?.artifact.content.document?.designSystemName;
  const needsDesignChoice = designUnavailableMessage !== null && !refineDesignSystemId;

  useLayoutEffect(() => {
    const textarea = feedbackRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, REFINE_TEXTAREA_MAX_HEIGHT)}px`;
  }, [feedback]);

  function handleFeedbackKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function registerEntry(id: string) {
    return (node: HTMLElement | null) => {
      if (node) entryRefs.current.set(id, node);
      else entryRefs.current.delete(id);
    };
  }

  async function startRefinement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedFeedback = feedback.trim();
    if (!trimmedFeedback || !canRefine || needsDesignChoice) return;
    setRefineError(null);
    setIsStartingRefine(true);
    try {
      const response = await refineArtifactRequest(
        artifactId,
        // Omitted, a refinement keeps its Design System pin.
        refineArtifactBody(artifactType, trimmedFeedback, refineDesignSystemId || undefined),
      );
      if (!response?.runId || typeof response.version !== "number") {
        throw new Error("The refinement run could not be started.");
      }
      appendUser(trimmedFeedback, `feedback-${response.version}`);
      setFeedback("");
      setRefineDesignSystemId(KEEP_DESIGN_SYSTEM);
      setDesignUnavailableMessage(null);
      beginRun("REFINE", artifactType);
      setActiveRunId(response.runId);
      router.replace(`${cleanArtifactUrl}?run=${encodeURIComponent(response.runId)}`);
    } catch (reason) {
      if (isDesignSystemUnavailable(reason)) {
        // The message is safe to show; the user must pick a system to retry with.
        setDesignUnavailableMessage(reason.message);
        setRefineDesignSystemId(KEEP_DESIGN_SYSTEM);
        return;
      }
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
      title={artifactTitle ?? (artifactType ? `New ${artifactTypeLabels[artifactType].toLowerCase()}` : "New artifact")}
      topbar={{
        back: { href: "/artifacts", label: "Back to artifacts" },
        subtitle: artifactType ? `${artifactTypeLabels[artifactType]} · Created with Mark` : "Creating with Mark",
        credits: { refreshKey: activeRunId },
      }}
      topbarExtra={isHydrated ? (
        <StudioOverflowMenu
          onDelete={() => {
            setDeleteError(null);
            setIsDeleteOpen(true);
          }}
          disabled={isDeleting || isEditing || savingVersion !== null || isStartingRefine || isAttaching}
        />
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
            <div className="mq-studio-user-message" key={entry.id} ref={registerEntry(entry.id)}>{entry.text}</div>
          ) : (
            <div className="mq-studio-assistant-message" key={entry.id} ref={registerEntry(entry.id)}>
              <div className="mq-studio-mark"><MarquillMark size={30} theme="auto" title="Mark" /></div>
              <div className="mq-studio-assistant-content">
                <div className="mq-studio-assistant-meta">
                  <span>Mark created version {entry.artifact.version}</span>
                  {entry.artifact.version !== entry.artifact.currentVersion && expandedVersions.has(entry.artifact.version) ? (
                    <button
                      type="button"
                      aria-expanded
                      onClick={() => setExpandedVersions((current) => {
                        const next = new Set(current);
                        next.delete(entry.artifact.version);
                        return next;
                      })}
                    >
                      Hide
                    </button>
                  ) : null}
                </div>
                {entry.artifact.version !== entry.artifact.currentVersion && !expandedVersions.has(entry.artifact.version) ? (
                  <CollapsedVersion
                    artifact={entry.artifact}
                    onExpand={() => setExpandedVersions((current) => new Set(current).add(entry.artifact.version))}
                  />
                ) : (
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
                    && !isAttaching
                  }
                  canAttach={isAttachableArtifact(entry.artifact)}
                  isAttachDisabled={
                    isEditing
                    || savingVersion !== null
                    || Boolean(activeRunId)
                    || isStartingRefine
                    || isDeleting
                  }
                  isAttaching={isAttaching}
                  attachError={
                    entry.artifact.version === entry.artifact.currentVersion
                      ? attachError
                      : null
                  }
                  isSaving={savingVersion === entry.artifact.version}
                  editError={entry.artifact.version === entry.artifact.currentVersion ? editError : null}
                  onEditingChange={(editing) => {
                    setIsEditing(editing);
                    if (editing) setConflictError(null);
                    setEditError(null);
                  }}
                  onAttach={() => requestAttach(entry.artifact)}
                  onSave={(request) => saveArtifact(entry.artifact.version, request)}
                />
                )}
              </div>
            </div>
          ))}

          {run ? (
            <div className="mq-studio-assistant-message mq-studio-run-message">
              <div className="mq-studio-mark"><MarquillMark size={30} theme="auto" title="Mark" /></div>
              <div className="mq-studio-assistant-content">
                <ArtifactRunProgress
                  run={run}
                  artifactType={artifactType}
                  artifactId={artifactId}
                  onRetryLoad={retryCompletedVersion}
                />
              </div>
            </div>
          ) : null}
        </div>

        {responses.length || run ? (
          <div className="mq-studio-refine-wrap">
            <form className="mq-studio-refine" onSubmit={startRefinement}>
              <label htmlFor="artifact-feedback" className="sr-only">Reply to refine the artifact</label>
              <textarea
                ref={feedbackRef}
                id="artifact-feedback"
                value={feedback}
                onChange={(event) => {
                  setFeedback(event.target.value);
                  if (refineError) setRefineError(null);
                }}
                onKeyDown={handleFeedbackKeyDown}
                placeholder={run ? "Mark is building your artifact…" : "Tell Mark what to change…"}
                maxLength={2000}
                rows={1}
                disabled={!canRefine}
              />
              <div className="mq-studio-refine-actions">
                {isDocument && responses.length ? (
                  <RefineDesignControl
                    state={designSystems.state}
                    systems={designSystems.systems}
                    value={refineDesignSystemId}
                    onChange={setRefineDesignSystemId}
                    onReload={() => void designSystems.reload()}
                    currentDesignName={currentDesignName}
                    unavailableMessage={designUnavailableMessage}
                    disabled={!canRefine}
                  />
                ) : null}
                <button
                  type="submit"
                  className="mq-studio-refine-submit"
                  disabled={!canRefine || !feedback.trim() || needsDesignChoice}
                  title={needsDesignChoice ? "Choose a design to refine with" : undefined}
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
        artifactTitle={artifactTitle}
        error={deleteError}
        onClose={() => {
          if (isDeleting) return;
          setIsDeleteOpen(false);
          setDeleteError(null);
        }}
        onConfirm={() => void deleteArtifact()}
      />
      <ConnectedAccountPicker
        isOpen={isAccountPickerOpen}
        accounts={attachableAccounts}
        isCreating={isAttaching}
        error={attachError}
        onClose={() => {
          if (isAttaching) return;
          setIsAccountPickerOpen(false);
          setAttachTarget(null);
          clearAttachError();
        }}
        onConfirm={(accountId) => {
          if (attachTarget) void createDraft(attachTarget, accountId);
        }}
      />
    </RedesignShell>
  );
}
