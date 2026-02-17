"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  Eye,
  Hash,
  ImagePlus,
  Info,
  MessageSquareText,
  RefreshCw,
  Repeat2,
  Send,
  SmilePlus,
  Sparkles,
  ThumbsUp,
  X,
} from "lucide-react";
import { UserAvatar } from "./components";
import type { DraftStatusResponse, PostDetailResponse } from "../lib/types";
import type { NewPostMode } from "./useNewPostModal";

export type NewPostModalAccount = {
  name?: string;
  avatarUrl?: string;
  provider?: string;
};

export type NewPostSubmitPayload = {
  mode: NewPostMode;
  postId?: string;
  content: string;
  imageFile?: File;
  imageUrl?: string;
  aiPrompt?: string;
  postType?: "quickPostLinkedin" | "insightPostLinkedin";
};

export type NewDraftGeneratePayload = {
  input: string;
  contentType: "quickPostLinkedin" | "insightPostLinkedin";
};

export type NewDraftGenerateResult = {
  draftId: string;
  message?: string;
};

type ComposerPhase = "ai_prompt" | "ai_progress" | "editor";

export default function NewPostModal({
  isOpen,
  mode,
  postId,
  initialContent,
  initialImageUrl,
  account,
  maxChars = 3000,
  onClose,
  onPublish,
  onSchedule,
  onSaveDraft,
  onGenerateDraft,
  onGetDraftStatus,
  onGetDraftById,
}: {
  isOpen: boolean;
  mode: NewPostMode;
  postId?: string;
  initialContent?: string;
  initialImageUrl?: string;
  account: NewPostModalAccount;
  maxChars?: number;
  onClose: () => void;
  onPublish: (payload: NewPostSubmitPayload) => Promise<void> | void;
  onSchedule: (payload: NewPostSubmitPayload) => Promise<void> | void;
  onSaveDraft: (payload: NewPostSubmitPayload) => Promise<void> | void;
  onGenerateDraft?: (payload: NewDraftGeneratePayload) => Promise<NewDraftGenerateResult>;
  onGetDraftStatus?: (draftId: string) => Promise<DraftStatusResponse>;
  onGetDraftById?: (draftId: string) => Promise<PostDetailResponse>;
}) {
  const [mounted, setMounted] = useState(false);
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const [phase, setPhase] = useState<ComposerPhase>(mode === "edit" ? "editor" : "ai_prompt");
  const [aiPrompt, setAiPrompt] = useState("");
  const [postType, setPostType] = useState<"quickPostLinkedin" | "insightPostLinkedin">(
    "quickPostLinkedin",
  );
  const [content, setContent] = useState(initialContent ?? "");
  const [imageFile, setImageFile] = useState<File | undefined>(undefined);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | undefined>(
    initialImageUrl,
  );
  const [pendingAction, setPendingAction] = useState<
    "publish" | "schedule" | "save" | "generate" | null
  >(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressStepLabel, setProgressStepLabel] = useState("Starting draft generation");
  const [isPolling, setIsPolling] = useState(false);
  const [pollStartedAt, setPollStartedAt] = useState<number | null>(null);

  const modalRef = useRef<HTMLDivElement | null>(null);
  const aiPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const generatedObjectUrlRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const streamTimerRef = useRef<number | null>(null);
  const pollInFlightRef = useRef(false);
  const isUnmountedRef = useRef(false);
  const isOpenRef = useRef(false);
  const POLL_INTERVAL_MS = 3000;
  const POLL_TIMEOUT_MS = 240000;

  useEffect(() => {
    setMounted(true);
    isUnmountedRef.current = false;
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setPhase(mode === "edit" ? "editor" : "ai_prompt");
    setIsPreviewVisible(false);
    setAiPrompt("");
    setPostType("quickPostLinkedin");
    setContent(initialContent ?? "");
    setImageFile(undefined);
    setImagePreviewUrl(initialImageUrl);
    setPromptError(null);
    setActiveDraftId(null);
    setProgressPercent(0);
    setProgressStepLabel("Starting draft generation");
    setIsPolling(false);
    setPollStartedAt(null);
    pollInFlightRef.current = false;
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (streamTimerRef.current !== null) {
      window.clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
  }, [isOpen, mode, initialContent, initialImageUrl]);

  useEffect(() => {
    isOpenRef.current = isOpen;
    if (isOpen) {
      return;
    }
    pollInFlightRef.current = false;
    setIsPolling(false);
    setPollStartedAt(null);
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (streamTimerRef.current !== null) {
      window.clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const target = phase === "ai_prompt" ? aiPromptRef.current : phase === "editor" ? editorRef.current : null;
    target?.focus();
  }, [isOpen, phase]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const modal = modalRef.current;
      if (!modal) {
        return;
      }

      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("disabled"));

      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement as HTMLElement | null;

      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [isOpen, onClose]);

  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      if (streamTimerRef.current !== null) {
        window.clearInterval(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      if (generatedObjectUrlRef.current) {
        URL.revokeObjectURL(generatedObjectUrlRef.current);
      }
    };
  }, []);

  const canSaveDraft = mode === "edit" && Boolean(postId);
  const charsUsed = content.length;
  const isNearLimit = charsUsed >= Math.floor(maxChars * 0.85);
  const isOverLimit = charsUsed > maxChars;
  const hasContent = content.trim().length > 0;
  const hasPreviewContent = hasContent || Boolean(imagePreviewUrl);
  const progressSegments = [0, 1, 2, 3].map((index) => {
    const segmentStart = index * 25;
    const segmentFill = ((progressPercent - segmentStart) / 25) * 100;
    return Math.max(0, Math.min(100, segmentFill));
  });

  const accountName = account.name?.trim() || "Connected account";
  const accountInitials = useMemo(() => {
    const parts = accountName.split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return "CA";
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }, [accountName]);

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const clearPollTimer = () => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const clearStreamTimer = () => {
    if (streamTimerRef.current !== null) {
      window.clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
  };

  const stopPolling = () => {
    clearPollTimer();
    pollInFlightRef.current = false;
    setIsPolling(false);
  };

  const streamContentInChunks = (fullContent: string) => {
    clearStreamTimer();
    setContent("");

    const chunks = toWordChunks(fullContent);
    if (chunks.length === 0) {
      setContent(fullContent);
      return;
    }

    let chunkIndex = 0;
    streamTimerRef.current = window.setInterval(() => {
      if (!isOpenRef.current || isUnmountedRef.current) {
        clearStreamTimer();
        return;
      }
      if (chunkIndex >= chunks.length) {
        clearStreamTimer();
        return;
      }
      const nextChunk = chunks[chunkIndex];
      setContent((previous) => `${previous}${nextChunk}`);
      chunkIndex += 1;
    }, 35);
  };

  const openEditorWithGeneratedDraft = async (draftId: string) => {
    stopPolling();
    setProgressPercent(100);
    setProgressStepLabel("Finalizing draft");

    let generatedContent = "";
    try {
      if (!onGetDraftById) {
        throw new Error("Draft retrieval is not available right now.");
      }
      const postPayload = await onGetDraftById(draftId);
      generatedContent = postPayload?.data?.content ?? "";
      setPromptError(null);
    } catch (error) {
      setPromptError(
        error instanceof Error ? error.message : "Unable to load generated draft content.",
      );
      generatedContent = "";
    }

    if (!isOpenRef.current || isUnmountedRef.current) {
      return;
    }

    setPhase("editor");
    streamContentInChunks(generatedContent);
  };

  const pollDraftStatus = async (draftId: string, startedAt: number) => {
    if (!isOpenRef.current || isUnmountedRef.current) {
      return false;
    }
    if (pollInFlightRef.current) {
      return true;
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= POLL_TIMEOUT_MS) {
      stopPolling();
      setPhase("ai_prompt");
      setPromptError("Draft generation is taking longer than expected. Please try again.");
      return false;
    }

    if (!onGetDraftStatus) {
      stopPolling();
      setPhase("ai_prompt");
      setPromptError("Draft status polling is not available right now.");
      return false;
    }

    pollInFlightRef.current = true;
    try {
      const statusPayload = await onGetDraftStatus(draftId);
      if (!isOpenRef.current || isUnmountedRef.current) {
        return false;
      }

      const statusFlag = String(statusPayload?.data?.status ?? "").trim().toLowerCase();
      if (statusFlag === "not found") {
        await openEditorWithGeneratedDraft(draftId);
        return false;
      }

      const rawPercentage = statusPayload?.data?.progress?.percentage;
      if (typeof rawPercentage === "number" && Number.isFinite(rawPercentage)) {
        const clampedPercentage = Math.max(0, Math.min(100, Math.round(rawPercentage)));
        setProgressPercent((currentValue) => Math.max(currentValue, clampedPercentage));
        if (clampedPercentage >= 100) {
          await openEditorWithGeneratedDraft(draftId);
          return false;
        }
      }

      const currentStep = statusPayload?.data?.progress?.currentStep;
      if (typeof currentStep === "string" && currentStep.trim().length > 0) {
        setProgressStepLabel(formatDraftStep(currentStep));
      }
      return true;
    } catch (error) {
      if (!isOpenRef.current || isUnmountedRef.current) {
        return false;
      }
      stopPolling();
      setPhase("ai_prompt");
      setPromptError(
        error instanceof Error ? error.message : "Unable to retrieve draft status.",
      );
      return false;
    } finally {
      pollInFlightRef.current = false;
    }
  };

  const handleGenerate = async () => {
    const input = aiPrompt.trim();
    if (!input) {
      setPromptError("Please add a prompt before generating a draft.");
      return;
    }
    if (!onGenerateDraft || !onGetDraftStatus || !onGetDraftById) {
      setPromptError("Draft generation is not available right now.");
      return;
    }

    setPromptError(null);
    setPendingAction("generate");
    try {
      const createdDraft = await onGenerateDraft({
        input,
        contentType: postType,
      });
      if (!createdDraft?.draftId) {
        throw new Error("Draft ID missing from response.");
      }

      if (!isOpenRef.current || isUnmountedRef.current) {
        return;
      }

      const draftId = createdDraft.draftId;
      const startedAt = Date.now();
      setActiveDraftId(draftId);
      setPollStartedAt(startedAt);
      setProgressPercent(0);
      setProgressStepLabel("Starting draft generation");
      setIsPreviewVisible(false);
      setIsPolling(true);
      setPhase("ai_progress");

      const shouldContinue = await pollDraftStatus(draftId, startedAt);
      if (!shouldContinue || !isOpenRef.current || isUnmountedRef.current) {
        return;
      }

      clearPollTimer();
      pollTimerRef.current = window.setInterval(() => {
        void (async () => {
          const keepPolling = await pollDraftStatus(draftId, startedAt);
          if (!keepPolling) {
            stopPolling();
          }
        })();
      }, POLL_INTERVAL_MS);
    } catch (error) {
      setPromptError(
        error instanceof Error ? error.message : "Unable to generate draft right now.",
      );
      setPhase("ai_prompt");
      stopPolling();
    } finally {
      setPendingAction(null);
    }
  };

  const handleFileChange = (file?: File) => {
    if (!file) {
      return;
    }

    if (generatedObjectUrlRef.current) {
      URL.revokeObjectURL(generatedObjectUrlRef.current);
      generatedObjectUrlRef.current = null;
    }

    const objectUrl = URL.createObjectURL(file);
    generatedObjectUrlRef.current = objectUrl;
    setImageFile(file);
    setImagePreviewUrl(objectUrl);
  };

  const onDropImage = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    handleFileChange(file);
  };

  const buildPayload = (): NewPostSubmitPayload => ({
    mode,
    postId,
    content,
    imageFile,
    imageUrl: imagePreviewUrl,
    aiPrompt,
    postType,
  });

  const runAction = async (
    action: "publish" | "schedule" | "save",
    callback: (payload: NewPostSubmitPayload) => Promise<void> | void,
  ) => {
    setPendingAction(action);
    try {
      await callback(buildPayload());
    } finally {
      setPendingAction(null);
    }
  };

  if (!mounted || !isOpen) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#12111A]/45 px-3 py-4 backdrop-blur-[2px] sm:px-6"
      onMouseDown={handleBackdropClick}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-post-modal-title"
        className="relative flex h-[min(92vh,920px)] w-full max-w-[1240px] flex-col overflow-hidden rounded-[24px] border border-[var(--color-border-inset)] bg-[var(--color-surface)] shadow-[0_36px_100px_-50px_rgba(15,23,42,0.55)]"
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4 sm:px-6">
          <h2
            id="new-post-modal-title"
            className="font-[var(--font-sora)] text-xl font-semibold text-[var(--color-text-primary)]"
          >
            {mode === "edit" ? "Edit Post" : "Create Post"}
          </h2>
          <div className="flex items-center gap-2">
            {phase !== "ai_progress" ? (
              <button
                type="button"
                onClick={() => setIsPreviewVisible((value) => !value)}
                aria-pressed={isPreviewVisible}
                aria-controls="new-post-linkedin-preview-panel"
                className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold transition ${
                  isPreviewVisible
                    ? "border-[#5575F5] bg-[#EEF3FF] text-[#1E40AF] shadow-[inset_0_0_0_1px_rgba(85,117,245,0.35)]"
                    : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                <Eye className="h-4 w-4" />
                Preview
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="grid h-10 w-10 place-items-center rounded-full text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background)] hover:text-[var(--color-text-primary)]"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div
          className={`grid min-h-0 flex-1 ${
            isPreviewVisible ? "grid-cols-1 lg:grid-cols-3" : "grid-cols-1"
          }`}
        >
          <section
            className={`min-h-0 overflow-y-auto border-b border-[var(--color-border)] px-5 py-5 sm:px-6 ${
              isPreviewVisible ? "lg:col-span-2 lg:border-b-0 lg:border-r" : "lg:border-b-0"
            }`}
          >
            {phase === "ai_prompt" ? (
              <div className="flex h-full min-h-[400px] flex-col rounded-3xl border border-[var(--color-border)] bg-[linear-gradient(160deg,rgba(123,140,255,0.08),rgba(255,255,255,0.95))] p-4 sm:p-6">
                <div className="mb-4 flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">What would you like to share?</p>
                </div>
                <textarea
                  ref={aiPromptRef}
                  value={aiPrompt}
                  onChange={(event) => {
                    setAiPrompt(event.target.value);
                    if (promptError) {
                      setPromptError(null);
                    }
                  }}
                  placeholder="Ask AI to draft your post..."
                  className="min-h-[220px] w-full resize-none rounded-2xl border border-[var(--color-border)] bg-white/90 px-4 py-3 text-sm text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-secondary)]/80 focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/15"
                />
                {promptError ? (
                  <p className="mt-3 text-sm font-medium text-rose-600">{promptError}</p>
                ) : null}
                <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                  <div className="relative">
                    <select
                      value={postType}
                      onChange={(event) =>
                        setPostType(
                          event.target.value as "quickPostLinkedin" | "insightPostLinkedin",
                        )
                      }
                      className="h-10 min-w-[220px] appearance-none rounded-full border border-[var(--color-border)] bg-white/90 pl-4 pr-10 text-sm font-semibold text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/15"
                      aria-label="Post type"
                    >
                      <option value="quickPostLinkedin">quickPostLinkedin</option>
                      <option value="insightPostLinkedin">insightPostLinkedin</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void handleGenerate();
                    }}
                    disabled={pendingAction !== null}
                    className="inline-flex items-center gap-2 rounded-full bg-[var(--color-secondary)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_18px_40px_-26px_rgba(28,27,39,0.55)] transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" />
                    {pendingAction === "generate" ? "Generating..." : "Generate draft"}
                  </button>
                </div>
              </div>
            ) : phase === "ai_progress" ? (
              <div className="flex min-h-[400px] flex-col rounded-3xl border border-[#dce5f4] bg-[linear-gradient(160deg,#edf4ff_0%,#f3f7ff_52%,#f7f9ff_100%)] p-4 sm:p-6">
                <div className="flex items-center justify-between">
                  <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-[#d8e4f6] text-[#152235] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
                    <Sparkles className="h-9 w-9" />
                  </div>
                  <div className="text-right">
                    <p className="font-[var(--font-sora)] text-3xl font-semibold text-[#152235]">Magic</p>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#5f6f8e]">
                      {isPolling ? "Generating" : "Preparing"}
                    </p>
                  </div>
                </div>
                <div className="mt-10 grid grid-cols-4 gap-4">
                  {progressSegments.map((segmentPercent, index) => (
                    <div
                      key={`progress-segment-${index}`}
                      className="h-7 overflow-hidden rounded-full bg-[#dbe5f1]"
                    >
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,#9ca8ef_0%,#c3b8f2_40%,#5fb2f5_100%)] transition-[width] duration-500 ease-out"
                        style={{ width: `${segmentPercent}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-8 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[#2e3e58]">
                    {progressPercent}% • {progressStepLabel}
                  </p>
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#6f7f9e]">
                    {pollStartedAt
                      ? `Started ${new Date(pollStartedAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : activeDraftId
                      ? `Draft ${activeDraftId.slice(0, 6)}`
                      : "Pending"}
                  </p>
                </div>
                {promptError ? (
                  <p className="mt-4 text-sm font-medium text-rose-600">{promptError}</p>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-full flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <UserAvatar
                      initials={accountInitials}
                      avatarUrl={account.avatarUrl}
                      sizeClass="h-11 w-11"
                    />
                    <span className="absolute -bottom-1 -right-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-white bg-white shadow-[0_6px_16px_-8px_rgba(15,23,42,0.45)]">
                      <img src="/LinkedIn_Icon_1.webp" alt="LinkedIn" className="h-3.5 w-3.5" />
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{accountName}</p>
                </div>
                {promptError ? (
                  <p className="text-sm font-medium text-rose-600">{promptError}</p>
                ) : null}

                <textarea
                  ref={editorRef}
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="Write your post..."
                  className="min-h-[180px] w-full resize-y rounded-2xl border border-[var(--color-border)] bg-white px-4 py-3 text-[15px] leading-6 text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-secondary)] focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/15"
                />

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={onDropImage}
                  onDragOver={(event) => event.preventDefault()}
                  className="group flex min-h-[132px] w-full flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--color-border-inset)] bg-[var(--color-background)]/45 px-4 py-6 text-center transition hover:border-[var(--color-primary)]/45 hover:bg-[var(--color-background)]"
                >
                  <ImagePlus className="h-7 w-7 text-[var(--color-text-secondary)] transition group-hover:text-[var(--color-primary)]" />
                  <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
                    Drag and drop an image, or <span className="font-semibold text-[var(--color-primary)]">choose file</span>
                  </p>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => handleFileChange(event.target.files?.[0])}
                />

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3">
                  <div className="flex items-center gap-1">
                    <ToolChip label="Rewrite" icon={<RefreshCw className="h-4 w-4" />} />
                    <ToolChip label="Emoji" icon={<SmilePlus className="h-4 w-4" />} />
                    <ToolChip label="Hashtag" icon={<Hash className="h-4 w-4" />} />
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                      isOverLimit
                        ? "border-rose-200 bg-rose-50 text-rose-600"
                        : isNearLimit
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)]"
                    }`}
                  >
                    {charsUsed}/{maxChars}
                  </span>
                </div>
              </div>
            )}
          </section>

          {isPreviewVisible && phase !== "ai_progress" ? (
            <aside
              id="new-post-linkedin-preview-panel"
              className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain bg-[var(--color-background)]/45 px-5 py-5 sm:px-6 lg:col-span-1"
            >
              <div className="mb-4 flex items-center gap-2">
                <p className="text-base font-semibold text-[var(--color-text-primary)]">
                  LinkedIn Preview
                </p>
                <div className="group relative inline-flex">
                  <button
                    type="button"
                    aria-label="Preview information"
                    aria-describedby="linkedin-preview-info-tooltip"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background)] hover:text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/25"
                  >
                    <Info className="h-4 w-4" />
                  </button>
                  <div
                    id="linkedin-preview-info-tooltip"
                    role="tooltip"
                    className="pointer-events-none absolute left-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] whitespace-normal break-words rounded-xl bg-[#666666] px-4 py-3 text-sm leading-6 text-white opacity-0 shadow-[0_14px_40px_-24px_rgba(15,23,42,0.65)] transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 sm:max-w-[360px]"
                  >
                    This is an approximation of what your posts will look like live. You
                    might see some differences across devices.
                  </div>
                </div>
              </div>
            <div className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-[0_20px_48px_-40px_rgba(15,23,42,0.45)]">
              <div className="flex items-start gap-3">
                <UserAvatar
                  initials={accountInitials}
                  avatarUrl={account.avatarUrl}
                  sizeClass="h-14 w-14"
                  textClass="text-base"
                />
                <div>
                  <p className="text-base font-semibold leading-tight text-[var(--color-text-primary)]">
                    {accountName}
                  </p>
                  <div className="mt-1 flex items-center gap-1 text-sm text-[var(--color-text-secondary)]">
                    <span>1h</span>
                    <span>•</span>
                    <InlineGlobeIcon />
                  </div>
                </div>
              </div>

              {hasPreviewContent ? (
                <>
                  {hasContent ? (
                    <p className="mt-4 whitespace-pre-wrap text-[15px] text-[var(--color-text-primary)]">
                      {content}
                    </p>
                  ) : null}
                  {imagePreviewUrl ? (
                    <img
                      src={imagePreviewUrl}
                      alt="Post preview"
                      className="mt-4 max-h-[360px] w-full rounded-xl border border-[var(--color-border)] object-cover"
                    />
                  ) : null}
                </>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-[var(--color-border-inset)] bg-[var(--color-background)]/60 px-4 py-6">
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    Your post preview appears here as you write.
                  </p>
                </div>
              )}

              <div className="mt-4 border-t border-[var(--color-border)] pt-3">
                <PreviewActionBar />
              </div>
            </div>
            </aside>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-white px-5 py-4 sm:px-6">
          <span
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
              isOverLimit
                ? "border-rose-200 bg-rose-50 text-rose-600"
                : isNearLimit
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)]"
            }`}
          >
            {charsUsed}/{maxChars}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!canSaveDraft || pendingAction !== null}
              onClick={() => runAction("save", onSaveDraft)}
              className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-text-secondary)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:pointer-events-none disabled:opacity-50"
            >
              {pendingAction === "save" ? "Saving..." : "Save draft"}
            </button>
            <button
              type="button"
              disabled={!hasContent || isOverLimit || pendingAction !== null}
              onClick={() => runAction("schedule", onSchedule)}
              className="inline-flex items-center rounded-full border border-[#DCCFA4] bg-[#F6F1DE] px-4 py-2 text-sm font-semibold text-[#7A5A00] transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-50"
            >
              {pendingAction === "schedule" ? "Scheduling..." : "Schedule Post"}
            </button>
            <button
              type="button"
              disabled={!hasContent || isOverLimit || pendingAction !== null}
              onClick={() => runAction("publish", onPublish)}
              className="inline-flex items-center rounded-full bg-[var(--color-secondary)] px-5 py-2 text-sm font-semibold text-white shadow-[0_18px_40px_-26px_rgba(28,27,39,0.55)] transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-50"
            >
              {pendingAction === "publish" ? "Publishing..." : "Publish"}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function toWordChunks(value: string) {
  if (!value) {
    return [];
  }
  return value.match(/\S+\s*/g) ?? [value];
}

function formatDraftStep(stepValue: string) {
  const normalized = stepValue
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return "Working on your draft";
  }

  return normalized
    .split(" ")
    .map((word) => {
      if (word === "linkedin") {
        return "LinkedIn";
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function ToolChip({ label, icon }: { label: string; icon: ReactNode }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
      aria-label={label}
      title={label}
    >
      {icon}
      {label}
    </button>
  );
}

function PreviewAction({ icon, ariaLabel }: { icon: ReactNode; ariaLabel: string }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className="inline-flex h-full w-full min-w-0 items-center justify-center rounded-lg border border-transparent p-2 text-[var(--color-text-primary)] transition hover:bg-[var(--color-background)]"
    >
      {icon}
    </button>
  );
}

function PreviewActionBar() {
  const iconSizeClass = "h-5 w-5";

  return (
    <div className="grid w-full grid-cols-4 pb-1">
      <PreviewAction ariaLabel="Like" icon={<ThumbsUp className={iconSizeClass} />} />
      <PreviewAction
        ariaLabel="Comment"
        icon={<MessageSquareText className={iconSizeClass} />}
      />
      <PreviewAction ariaLabel="Repost" icon={<Repeat2 className={iconSizeClass} />} />
      <PreviewAction ariaLabel="Send" icon={<Send className={iconSizeClass} />} />
    </div>
  );
}

function InlineGlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M3 12h18M12 3c2.5 2.5 4 5.7 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.7-4-9s1.5-6.5 4-9z" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
