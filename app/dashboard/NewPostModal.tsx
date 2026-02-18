"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  Repeat2,
  Search,
  Send,
  SmilePlus,
  Sparkles,
  ThumbsUp,
  X,
} from "lucide-react";
import { UserAvatar } from "./components";
import type {
  DraftStatusResponse,
  LinkedinImageDetailsResponse,
  PostDetailResponse,
  PostMediaItem,
} from "../lib/types";
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
  imageSource?: "device" | "unsplash" | "existing";
  imageMimeType?: string;
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
const EMOJI_OPTIONS = ["😀", "🎉", "🚀", "🔥", "💡", "👏", "✅", "📈", "🤝", "🙌"];
const DEFAULT_UNSPLASH_QUERY = "nature";
const UNSPLASH_PAGE_SIZE = 10;

type UnsplashPhoto = {
  id: string;
  alt_description?: string | null;
  urls?: {
    small?: string;
    regular?: string;
  };
  user?: {
    name?: string;
    links?: {
      html?: string;
    };
  };
};

type UnsplashSearchResponse = {
  results?: UnsplashPhoto[];
};

type CachedLinkedinImage = {
  downloadUrl?: string;
  downloadUrlExpiresAt?: number;
};

type PreviewMediaFetchStatus = "idle" | "loading" | "done";

type PreviewMediaFetchState = {
  postId: string | null;
  status: PreviewMediaFetchStatus;
};

function withUnsplashReferral(url?: string) {
  if (!url) {
    return "https://unsplash.com";
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}utm_source=marquill&utm_medium=referral`;
}

function dedupeUnsplashPhotos(photos: UnsplashPhoto[]) {
  const seen = new Set<string>();
  return photos.filter((photo) => {
    if (!photo?.id || seen.has(photo.id)) {
      return false;
    }
    seen.add(photo.id);
    return true;
  });
}

function extractMediaUrns(mediaItems?: PostMediaItem[]) {
  if (!Array.isArray(mediaItems)) {
    return [];
  }
  return mediaItems
    .map((item) => item?.id?.trim())
    .filter((id): id is string => Boolean(id));
}

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
  onGetLinkedinImageByUrn,
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
  onGetLinkedinImageByUrn?: (urn: string) => Promise<LinkedinImageDetailsResponse>;
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
  const [imageSource, setImageSource] = useState<"device" | "unsplash" | "existing" | undefined>(
    initialImageUrl ? "existing" : undefined,
  );
  const [imageMimeType, setImageMimeType] = useState<string | undefined>(undefined);
  const [resolvedLinkedinPreviewUrl, setResolvedLinkedinPreviewUrl] = useState<string | null>(
    null,
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
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [isMediaMenuOpen, setIsMediaMenuOpen] = useState(false);
  const [selectedMediaSource, setSelectedMediaSource] = useState<"device" | "unsplash">("device");
  const [isUnsplashModalOpen, setIsUnsplashModalOpen] = useState(false);
  const [unsplashQuery, setUnsplashQuery] = useState(DEFAULT_UNSPLASH_QUERY);
  const [unsplashCommittedQuery, setUnsplashCommittedQuery] = useState(DEFAULT_UNSPLASH_QUERY);
  const [unsplashImages, setUnsplashImages] = useState<UnsplashPhoto[]>([]);
  const [unsplashPage, setUnsplashPage] = useState(0);
  const [unsplashHasMore, setUnsplashHasMore] = useState(true);
  const [unsplashIsLoading, setUnsplashIsLoading] = useState(false);
  const [unsplashError, setUnsplashError] = useState<string | null>(null);
  const [postMediaUrns, setPostMediaUrns] = useState<string[]>([]);
  const [isResolvingPreviewMedia, setIsResolvingPreviewMedia] = useState(false);
  const [hasUserSelectedUnsplashImage, setHasUserSelectedUnsplashImage] = useState(false);

  const modalRef = useRef<HTMLDivElement | null>(null);
  const aiPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const mediaMenuRef = useRef<HTMLDivElement | null>(null);
  const unsplashModalRef = useRef<HTMLDivElement | null>(null);
  const unsplashScrollRef = useRef<HTMLDivElement | null>(null);
  const unsplashSentinelRef = useRef<HTMLDivElement | null>(null);
  const unsplashInFlightRef = useRef<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const generatedObjectUrlRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const streamTimerRef = useRef<number | null>(null);
  const pollInFlightRef = useRef(false);
  const previewMediaFetchStateRef = useRef<PreviewMediaFetchState>({
    postId: null,
    status: "idle",
  });
  const activePreviewPostIdRef = useRef<string | null>(null);
  const mediaFetchRequestSeqRef = useRef(0);
  const mediaResolveRequestSeqRef = useRef(0);
  const previousEditPostIdRef = useRef<string | undefined>(undefined);
  const isUnmountedRef = useRef(false);
  const isOpenRef = useRef(false);
  const selectionRangeRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const POLL_INTERVAL_MS = 3000;
  const POLL_TIMEOUT_MS = 240000;
  const unsplashAccessKey = process.env.NEXT_PUBLIC_UNSPLASH_ACCESS_KEY?.trim() ?? "";

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
    setImageSource(initialImageUrl ? "existing" : undefined);
    setImageMimeType(undefined);
    setResolvedLinkedinPreviewUrl(null);
    setPromptError(null);
    setActiveDraftId(null);
    setProgressPercent(0);
    setProgressStepLabel("Starting draft generation");
    setIsPolling(false);
    setPollStartedAt(null);
    setIsEmojiPickerOpen(false);
    setIsMediaMenuOpen(false);
    setSelectedMediaSource("device");
    setIsUnsplashModalOpen(false);
    setUnsplashQuery(DEFAULT_UNSPLASH_QUERY);
    setUnsplashCommittedQuery(DEFAULT_UNSPLASH_QUERY);
    setUnsplashImages([]);
    setUnsplashPage(0);
    setUnsplashHasMore(true);
    setUnsplashIsLoading(false);
    setUnsplashError(null);
    setPostMediaUrns([]);
    setIsResolvingPreviewMedia(false);
    setHasUserSelectedUnsplashImage(false);
    previewMediaFetchStateRef.current = { postId: null, status: "idle" };
    unsplashInFlightRef.current = "";
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
    setIsUnsplashModalOpen(false);
    setIsResolvingPreviewMedia(false);
    setResolvedLinkedinPreviewUrl(null);
    previewMediaFetchStateRef.current = { postId: null, status: "idle" };
    activePreviewPostIdRef.current = null;
    previousEditPostIdRef.current = undefined;
    unsplashInFlightRef.current = "";
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
    if (!isOpen || mode !== "edit") {
      return;
    }
    if (previousEditPostIdRef.current === postId) {
      return;
    }

    previousEditPostIdRef.current = postId;
    activePreviewPostIdRef.current = postId ?? null;
    previewMediaFetchStateRef.current = { postId: postId ?? null, status: "idle" };
    setPostMediaUrns([]);
    setResolvedLinkedinPreviewUrl(null);
    setIsResolvingPreviewMedia(false);
    setImageFile(undefined);
    setImagePreviewUrl(initialImageUrl);
    setImageSource(initialImageUrl ? "existing" : undefined);
    setImageMimeType(undefined);
    setHasUserSelectedUnsplashImage(false);
  }, [initialImageUrl, isOpen, mode, postId]);

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
        if (isUnsplashModalOpen) {
          event.preventDefault();
          setIsUnsplashModalOpen(false);
          return;
        }
        if (isMediaMenuOpen) {
          event.preventDefault();
          setIsMediaMenuOpen(false);
          return;
        }
        if (isEmojiPickerOpen) {
          event.preventDefault();
          setIsEmojiPickerOpen(false);
          return;
        }
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const modal = isUnsplashModalOpen ? unsplashModalRef.current : modalRef.current;
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
  }, [isEmojiPickerOpen, isMediaMenuOpen, isOpen, isUnsplashModalOpen, onClose]);

  useEffect(() => {
    if (!isEmojiPickerOpen) {
      return;
    }
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (emojiPickerRef.current?.contains(target)) {
        return;
      }
      if (target instanceof Element && target.closest("[data-emoji-trigger='true']")) {
        return;
      }
      setIsEmojiPickerOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isEmojiPickerOpen]);

  useEffect(() => {
    if (!isMediaMenuOpen) {
      return;
    }
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (mediaMenuRef.current?.contains(target)) {
        return;
      }
      if (target instanceof Element && target.closest("[data-media-trigger='true']")) {
        return;
      }
      setIsMediaMenuOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isMediaMenuOpen]);

  useEffect(() => {
    if (!isUnsplashModalOpen || unsplashPage < 1) {
      return;
    }
    if (!unsplashAccessKey) {
      setUnsplashError("Unsplash access key is missing.");
      setUnsplashHasMore(false);
      return;
    }

    const inFlightKey = `${unsplashCommittedQuery}:${unsplashPage}`;
    if (unsplashInFlightRef.current === inFlightKey) {
      return;
    }
    unsplashInFlightRef.current = inFlightKey;

    const controller = new AbortController();
    const query = unsplashCommittedQuery.trim() || DEFAULT_UNSPLASH_QUERY;
    const params = new URLSearchParams({
      query,
      page: String(unsplashPage),
      per_page: String(UNSPLASH_PAGE_SIZE),
    });

    setUnsplashIsLoading(true);

    void (async () => {
      try {
        const response = await fetch(`https://api.unsplash.com/search/photos?${params.toString()}`, {
          headers: {
            Authorization: `Client-ID ${unsplashAccessKey}`,
          },
          signal: controller.signal,
        });
        const payload = (await response.json()) as UnsplashSearchResponse;
        if (!response.ok) {
          throw new Error("Unable to load Unsplash images.");
        }

        const results = Array.isArray(payload?.results)
          ? dedupeUnsplashPhotos(payload.results)
          : [];

        setUnsplashImages((current) =>
          unsplashPage === 1
            ? results
            : dedupeUnsplashPhotos([...current, ...results]),
        );
        setUnsplashHasMore(results.length === UNSPLASH_PAGE_SIZE);
        setUnsplashError(null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setUnsplashError(
          error instanceof Error ? error.message : "Unable to load Unsplash images.",
        );
        setUnsplashHasMore(false);
      } finally {
        setUnsplashIsLoading(false);
        if (unsplashInFlightRef.current === inFlightKey) {
          unsplashInFlightRef.current = "";
        }
      }
    })();

    return () => controller.abort();
  }, [isUnsplashModalOpen, unsplashAccessKey, unsplashCommittedQuery, unsplashPage]);

  useEffect(() => {
    if (!isUnsplashModalOpen || !unsplashHasMore || unsplashIsLoading) {
      return;
    }
    const root = unsplashScrollRef.current;
    const target = unsplashSentinelRef.current;
    if (!root || !target) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const isIntersecting = entries.some((entry) => entry.isIntersecting);
        if (!isIntersecting || unsplashInFlightRef.current) {
          return;
        }
        setUnsplashPage((current) => current + 1);
      },
      {
        root,
        threshold: 0.2,
        rootMargin: "180px 0px",
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [isUnsplashModalOpen, unsplashHasMore, unsplashIsLoading]);

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
  const hasPreviewContent = hasContent || Boolean(imagePreviewUrl ?? resolvedLinkedinPreviewUrl);
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
    let resolvedMediaUrns: string[] = [];
    try {
      if (!onGetDraftById) {
        throw new Error("Draft retrieval is not available right now.");
      }
      const postPayload = await onGetDraftById(draftId);
      generatedContent = postPayload?.data?.content ?? "";
      resolvedMediaUrns = extractMediaUrns(postPayload?.data?.media);
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
    setPostMediaUrns(resolvedMediaUrns);
    previewMediaFetchStateRef.current = { postId: draftId, status: "done" };
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
    setImageSource("device");
    setImageMimeType(file.type || undefined);
    setResolvedLinkedinPreviewUrl(null);
    setHasUserSelectedUnsplashImage(false);
  };

  const openUnsplashModal = () => {
    setUnsplashQuery(DEFAULT_UNSPLASH_QUERY);
    setUnsplashCommittedQuery(DEFAULT_UNSPLASH_QUERY);
    setUnsplashImages([]);
    setUnsplashPage(1);
    setUnsplashHasMore(true);
    setUnsplashError(null);
    setIsUnsplashModalOpen(true);
  };

  const openSelectedMediaSource = () => {
    if (selectedMediaSource === "device") {
      fileInputRef.current?.click();
      return;
    }
    openUnsplashModal();
  };

  const runUnsplashSearch = () => {
    const query = unsplashQuery.trim() || DEFAULT_UNSPLASH_QUERY;
    setUnsplashCommittedQuery(query);
    setUnsplashImages([]);
    setUnsplashPage(1);
    setUnsplashHasMore(true);
    setUnsplashError(null);
    unsplashInFlightRef.current = "";
  };

  const handleSelectUnsplashPhoto = (photo: UnsplashPhoto) => {
    const selectedUrl = photo.urls?.regular ?? photo.urls?.small;
    if (!selectedUrl) {
      return;
    }
    setImageFile(undefined);
    setImagePreviewUrl(selectedUrl);
    setImageSource("unsplash");
    setImageMimeType(undefined);
    setResolvedLinkedinPreviewUrl(null);
    setIsUnsplashModalOpen(false);
    setSelectedMediaSource("unsplash");
    setHasUserSelectedUnsplashImage(true);
    window.requestAnimationFrame(() => {
      editorRef.current?.focus();
    });
  };

  const syncEditorSelection = () => {
    const editorElement = editorRef.current;
    if (!editorElement) {
      return;
    }
    selectionRangeRef.current = {
      start: editorElement.selectionStart ?? 0,
      end: editorElement.selectionEnd ?? 0,
    };
  };

  const resizeEditorToContent = () => {
    const editorElement = editorRef.current;
    if (!editorElement) {
      return;
    }
    editorElement.style.height = "auto";
    editorElement.style.height = `${editorElement.scrollHeight}px`;
  };

  useEffect(() => {
    if (!isOpen || phase !== "editor") {
      return;
    }
    const rafId = window.requestAnimationFrame(() => {
      resizeEditorToContent();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [content, isOpen, phase]);

  const insertTextAtCursor = (textToInsert: string) => {
    const editorElement = editorRef.current;
    const currentSelection = selectionRangeRef.current;
    const rawStart = editorElement?.selectionStart ?? currentSelection.start ?? content.length;
    const rawEnd = editorElement?.selectionEnd ?? currentSelection.end ?? content.length;
    const safeStart = Math.max(0, Math.min(rawStart, content.length));
    const safeEnd = Math.max(safeStart, Math.min(rawEnd, content.length));
    const nextContent = `${content.slice(0, safeStart)}${textToInsert}${content.slice(safeEnd)}`;
    const nextCursorIndex = safeStart + textToInsert.length;

    setContent(nextContent);
    selectionRangeRef.current = { start: nextCursorIndex, end: nextCursorIndex };

    window.requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }
      editor.focus();
      editor.setSelectionRange(nextCursorIndex, nextCursorIndex);
      resizeEditorToContent();
    });
  };

  const resolveLinkedinMediaUrlFromCacheOrApi = useCallback(
    async (urns: string[]): Promise<string | undefined> => {
      if (!onGetLinkedinImageByUrn) {
        return undefined;
      }

      for (const urn of urns) {
        const normalizedUrn = urn.trim();
        if (!normalizedUrn) {
          continue;
        }

        try {
          const cachedRaw = window.localStorage.getItem(normalizedUrn);
          if (cachedRaw) {
            const cached = JSON.parse(cachedRaw) as CachedLinkedinImage;
            const cachedUrl = cached?.downloadUrl;
            const cachedExpiry = cached?.downloadUrlExpiresAt;
            if (
              typeof cachedUrl === "string" &&
              cachedUrl.length > 0 &&
              typeof cachedExpiry === "number" &&
              cachedExpiry > Date.now()
            ) {
              return cachedUrl;
            }
          }
        } catch {
          // Ignore localStorage/cache parsing issues and fallback to API.
        }

        try {
          const details = await onGetLinkedinImageByUrn(normalizedUrn);
          const resolvedUrl = details?.data?.downloadUrl;
          const resolvedExpiry = details?.data?.downloadUrlExpiresAt;
          if (
            typeof resolvedUrl === "string" &&
            resolvedUrl.length > 0 &&
            typeof resolvedExpiry === "number"
          ) {
            try {
              window.localStorage.setItem(
                normalizedUrn,
                JSON.stringify({
                  downloadUrl: resolvedUrl,
                  downloadUrlExpiresAt: resolvedExpiry,
                } satisfies CachedLinkedinImage),
              );
            } catch {
              // Ignore storage write errors and continue with resolved URL.
            }
            return resolvedUrl;
          }
        } catch {
          // Try next URN if available.
        }
      }

      return undefined;
    },
    [onGetLinkedinImageByUrn],
  );

  useEffect(() => {
    if (!isOpen || !isPreviewVisible) {
      return;
    }
    if (!postId || !onGetDraftById || postMediaUrns.length > 0) {
      return;
    }

    const currentFetchState = previewMediaFetchStateRef.current;
    if (currentFetchState.postId !== postId) {
      previewMediaFetchStateRef.current = { postId, status: "idle" };
    } else if (currentFetchState.status === "loading" || currentFetchState.status === "done") {
      return;
    }

    let cancelled = false;
    let completed = false;
    const targetPostId = postId;
    const requestSeq = mediaFetchRequestSeqRef.current + 1;
    mediaFetchRequestSeqRef.current = requestSeq;
    previewMediaFetchStateRef.current = { postId: targetPostId, status: "loading" };
    activePreviewPostIdRef.current = targetPostId;

    const fetchPostMediaUrns = async () => {
      try {
        const postPayload = await onGetDraftById(targetPostId);
        const urns = extractMediaUrns(postPayload?.data?.media);
        if (
          !cancelled &&
          mediaFetchRequestSeqRef.current === requestSeq &&
          activePreviewPostIdRef.current === targetPostId
        ) {
          setPostMediaUrns(urns);
          if (urns.length === 0) {
            setResolvedLinkedinPreviewUrl(null);
          }
          previewMediaFetchStateRef.current = { postId: targetPostId, status: "done" };
          completed = true;
        }
      } catch {
        if (
          !cancelled &&
          mediaFetchRequestSeqRef.current === requestSeq &&
          activePreviewPostIdRef.current === targetPostId
        ) {
          previewMediaFetchStateRef.current = { postId: targetPostId, status: "idle" };
        }
      } finally {
        if (
          !completed &&
          mediaFetchRequestSeqRef.current === requestSeq &&
          activePreviewPostIdRef.current === targetPostId
        ) {
          previewMediaFetchStateRef.current = { postId: targetPostId, status: "idle" };
        }
      }
    };

    void fetchPostMediaUrns();

    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    isPreviewVisible,
    onGetDraftById,
    postId,
    postMediaUrns.length,
  ]);

  useEffect(() => {
    if (!isOpen || !isPreviewVisible) {
      return;
    }
    if (postMediaUrns.length === 0) {
      if (!imagePreviewUrl) {
        setResolvedLinkedinPreviewUrl(null);
      }
      return;
    }
    if (imageFile || hasUserSelectedUnsplashImage || isResolvingPreviewMedia) {
      return;
    }

    let cancelled = false;
    const targetPostId = postId ?? null;
    const requestSeq = mediaResolveRequestSeqRef.current + 1;
    mediaResolveRequestSeqRef.current = requestSeq;

    const resolvePreviewMedia = async () => {
      setIsResolvingPreviewMedia(true);
      try {
        const resolvedUrl = await resolveLinkedinMediaUrlFromCacheOrApi(postMediaUrns);
        if (
          !cancelled &&
          mediaResolveRequestSeqRef.current === requestSeq &&
          activePreviewPostIdRef.current === targetPostId &&
          resolvedUrl &&
          !imageFile &&
          !hasUserSelectedUnsplashImage
        ) {
          setResolvedLinkedinPreviewUrl(resolvedUrl);
        }
      } finally {
        if (
          !cancelled &&
          mediaResolveRequestSeqRef.current === requestSeq &&
          activePreviewPostIdRef.current === targetPostId
        ) {
          setIsResolvingPreviewMedia(false);
        }
      }
    };

    void resolvePreviewMedia();

    return () => {
      cancelled = true;
    };
  }, [
    hasUserSelectedUnsplashImage,
    imageFile,
    imagePreviewUrl,
    isOpen,
    isPreviewVisible,
    isResolvingPreviewMedia,
    postId,
    postMediaUrns,
    resolveLinkedinMediaUrlFromCacheOrApi,
  ]);

  const previewImageSrc = imagePreviewUrl ?? resolvedLinkedinPreviewUrl ?? undefined;

  const buildPayload = (): NewPostSubmitPayload => ({
    mode,
    postId,
    content,
    imageFile,
    imageUrl: imagePreviewUrl,
    imageSource,
    imageMimeType,
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
    <>
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
                {promptError ? (
                  <p className="text-sm font-medium text-rose-600">{promptError}</p>
                ) : null}
                <div className="overflow-visible rounded-2xl border border-[#d6dae3] bg-white">
                  <div className="p-4 sm:p-5">
                    <div className="flex items-start gap-3">
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
                      <div className="min-w-0 flex-1 rounded-xl border border-transparent bg-transparent px-1 transition">
                        <textarea
                          ref={editorRef}
                          value={content}
                          onChange={(event) => setContent(event.target.value)}
                          onSelect={syncEditorSelection}
                          onClick={syncEditorSelection}
                          onKeyUp={syncEditorSelection}
                          placeholder="Write your post..."
                          className="min-h-[260px] w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[15px] leading-9 text-[var(--color-text-primary)] outline-none placeholder:text-[#6d7482]"
                        />
                      </div>
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(event) => handleFileChange(event.target.files?.[0])}
                    />
                  </div>

                  <div className="border-t border-[#dbe0ea] px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="relative flex items-center gap-1">
                        <button
                          type="button"
                          onClick={openSelectedMediaSource}
                          aria-label="Upload media"
                          data-media-trigger="true"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-primary)] transition hover:bg-[#f2f4f9]"
                        >
                          <ImagePlus className="h-5 w-5" />
                        </button>
                        <span className="h-7 w-px bg-[#d9dee8]" />
                        <button
                          type="button"
                          onClick={() => setIsMediaMenuOpen((value) => !value)}
                          aria-haspopup="menu"
                          aria-expanded={isMediaMenuOpen}
                          aria-controls="editor-media-menu"
                          aria-label="More media options"
                          data-media-trigger="true"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-primary)] transition hover:bg-[#f2f4f9]"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </button>
                        {isMediaMenuOpen ? (
                          <div
                            id="editor-media-menu"
                            ref={mediaMenuRef}
                            role="menu"
                            aria-label="Media source options"
                            className="absolute left-0 top-full z-[70] mt-2 min-w-[224px] rounded-xl border border-[#d6dae3] bg-white p-1 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.45)]"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setSelectedMediaSource("device");
                                setIsMediaMenuOpen(false);
                                fileInputRef.current?.click();
                              }}
                              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition hover:bg-[#f2f4f9] ${
                                selectedMediaSource === "device"
                                  ? "bg-[#eef3ff] text-[#1e40af]"
                                  : "text-[var(--color-text-primary)]"
                              }`}
                            >
                              <span>From your device</span>
                              {selectedMediaSource === "device" ? (
                                <span className="text-xs font-semibold uppercase tracking-[0.08em]">Default</span>
                              ) : null}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setSelectedMediaSource("unsplash");
                                setIsMediaMenuOpen(false);
                                openUnsplashModal();
                              }}
                              className={`mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition hover:bg-[#f2f4f9] ${
                                selectedMediaSource === "unsplash"
                                  ? "bg-[#eef3ff] text-[#1e40af]"
                                  : "text-[var(--color-text-primary)]"
                              }`}
                            >
                              <img src="/unsplash.svg" alt="" aria-hidden="true" className="h-4 w-4" />
                              <span>Browse Unsplash</span>
                            </button>
                          </div>
                        ) : null}
                        <span className="h-7 w-px bg-[#d9dee8]" />

                        <div className="relative">
                          <button
                            type="button"
                            data-emoji-trigger="true"
                            onMouseDown={syncEditorSelection}
                            onClick={() => setIsEmojiPickerOpen((value) => !value)}
                            aria-expanded={isEmojiPickerOpen}
                            aria-haspopup="dialog"
                            aria-label="Insert emoji"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-primary)] transition hover:bg-[#f2f4f9]"
                          >
                            <SmilePlus className="h-5 w-5" />
                          </button>
                          {isEmojiPickerOpen ? (
                            <div
                              ref={emojiPickerRef}
                              role="dialog"
                              aria-label="Emoji picker"
                              className="absolute bottom-full left-0 z-50 mb-2 w-[224px] rounded-xl border border-[#d6dae3] bg-white p-2 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.45)]"
                            >
                              <div className="grid grid-cols-5 gap-1">
                                {EMOJI_OPTIONS.map((emoji) => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => {
                                      insertTextAtCursor(emoji);
                                      setIsEmojiPickerOpen(false);
                                    }}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-lg transition hover:bg-[#f3f5fa]"
                                    aria-label={`Insert ${emoji}`}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <button
                          type="button"
                          onMouseDown={syncEditorSelection}
                          onClick={() => insertTextAtCursor("#")}
                          aria-label="Insert hashtag"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-primary)] transition hover:bg-[#f2f4f9]"
                        >
                          <Hash className="h-5 w-5" />
                        </button>
                      </div>
                      <span
                        className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
                          isOverLimit
                            ? "border-rose-200 bg-rose-50 text-rose-600"
                            : isNearLimit
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-[#7c828f] bg-white text-[#5c6370]"
                        }`}
                      >
                        {charsUsed}
                      </span>
                    </div>
                  </div>

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
                  {previewImageSrc ? (
                    <img
                      src={previewImageSrc}
                      alt="Post preview"
                      referrerPolicy="no-referrer"
                      onError={() => {
                        if (!imagePreviewUrl) {
                          setResolvedLinkedinPreviewUrl(null);
                        }
                      }}
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
      {isUnsplashModalOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-[#12111A]/40 px-3 py-4 backdrop-blur-[1px] sm:px-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsUnsplashModalOpen(false);
            }
          }}
        >
          <div
            ref={unsplashModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsplash-modal-title"
            className="flex h-[min(90vh,860px)] w-full max-w-[1280px] flex-col rounded-2xl border border-[#d6dae3] bg-white shadow-[0_28px_90px_-45px_rgba(15,23,42,0.55)]"
          >
            <header className="flex items-center justify-between border-b border-[#dbe0ea] px-5 py-4">
              <div className="flex items-center gap-3">
                <img src="/unsplash.svg" alt="" aria-hidden="true" className="h-5 w-5" />
                <h3 id="unsplash-modal-title" className="text-[32px] font-semibold text-[var(--color-text-primary)]">
                  Unsplash
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsUnsplashModalOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition hover:bg-[#f2f4f9] hover:text-[var(--color-text-primary)]"
                aria-label="Close Unsplash search"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="flex items-center gap-3 border-b border-[#dbe0ea] px-5 py-4">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
                <input
                  type="text"
                  value={unsplashQuery}
                  onChange={(event) => setUnsplashQuery(event.target.value)}
                  placeholder="Search free high resolution photos"
                  className="h-12 w-full rounded-lg border border-[#cfd5e1] bg-white pl-10 pr-3 text-base text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/15"
                />
              </div>
              <button
                type="button"
                onClick={runUnsplashSearch}
                className="inline-flex h-12 items-center justify-center rounded-lg bg-[#2f54eb] px-6 text-base font-semibold text-white transition hover:brightness-95"
              >
                Search
              </button>
            </div>

            <div ref={unsplashScrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {unsplashError ? (
                <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {unsplashError}
                </p>
              ) : null}
              {!unsplashIsLoading && !unsplashError && unsplashImages.length === 0 ? (
                <p className="text-sm text-[var(--color-text-secondary)]">No images found. Try another search.</p>
              ) : null}
              <div className="columns-1 gap-5 md:columns-2 lg:columns-3">
                {unsplashImages.map((photo) => {
                  const previewUrl = photo.urls?.small;
                  const creatorName = photo.user?.name || "Unknown creator";
                  const creatorUrl = withUnsplashReferral(photo.user?.links?.html);
                  const altText = photo.alt_description?.trim() || `Unsplash image by ${creatorName}`;

                  return (
                    <article key={photo.id} className="mb-5 break-inside-avoid">
                      <button
                        type="button"
                        onClick={() => handleSelectUnsplashPhoto(photo)}
                        className="w-full overflow-hidden rounded-md border border-[#d6dae3] bg-white text-left transition hover:shadow-[0_14px_32px_-24px_rgba(15,23,42,0.45)]"
                      >
                        {previewUrl ? (
                          <img src={previewUrl} alt={altText} className="h-auto w-full object-cover" />
                        ) : (
                          <div className="grid h-48 w-full place-items-center bg-[#f4f6fb] text-sm text-[var(--color-text-secondary)]">
                            Image unavailable
                          </div>
                        )}
                      </button>
                      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                        <a
                          href={creatorUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="underline underline-offset-2 hover:text-[var(--color-text-primary)]"
                        >
                          {creatorName}
                        </a>{" "}
                        for{" "}
                        <a
                          href={withUnsplashReferral("https://unsplash.com")}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="underline underline-offset-2 hover:text-[var(--color-text-primary)]"
                        >
                          Unsplash
                        </a>
                      </p>
                    </article>
                  );
                })}
              </div>
              <div ref={unsplashSentinelRef} className="h-8 w-full" />
              {unsplashIsLoading ? (
                <p className="py-2 text-center text-sm text-[var(--color-text-secondary)]">Loading images...</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      </div>
    </>,
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
