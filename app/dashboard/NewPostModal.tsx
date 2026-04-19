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
  ArrowUp,
  CalendarClock,
  ChevronDown,
  Clock3,
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
import { UserAvatar, CustomSelect, type SelectOption } from "./components";
import type {
  DraftStatusResponse,
  LinkedinImageDetailsResponse,
  PostDetailResponse,
  PostMediaItem,
} from "../lib/types";
import { StylePreset } from "../lib/types";
import type { NewPostMode } from "./useNewPostModal";

export type NewPostModalAccount = {
  name?: string;
  avatarUrl?: string;
  headline?: string;
  provider?: string;
};

export type NewPostSubmitPayload = {
  mode: NewPostMode;
  postId?: string;
  content: string;
  /** Device-uploaded File objects (images or 1 video) */
  mediaFiles?: File[];
  /** Stock image URLs (Unsplash / Pexels) to be fetched and uploaded */
  mediaUrls?: string[];
  mediaSource?: "device" | "unsplash" | "pexels" | "existing";
  mediaType?: "images" | "video";
  scheduledTime?: string;
  timezone?: string;
  aiPrompt?: string;
  postType?: "quickPostLinkedin" | "insightPostLinkedin";
};

export type NewDraftGeneratePayload = {
  input: string;
  contentType: "quickPostLinkedin" | "insightPostLinkedin";
  stylePreset: StylePreset;
};

export type NewDraftGenerateResult = {
  draftId: string;
  message?: string;
};

type ComposerPhase = "ai_prompt" | "ai_progress" | "editor";
const EMOJI_OPTIONS = ["😀", "🎉", "🚀", "🔥", "💡", "👏", "✅", "📈", "🤝", "🙌"];
const DEFAULT_UNSPLASH_QUERY = "nature";
const UNSPLASH_PAGE_SIZE = 10;

const POST_TYPE_OPTIONS: SelectOption[] = [
  { value: "quickPostLinkedin", label: "Quick Post (LinkedIn)" },
  { value: "insightPostLinkedin", label: "Insight Post (LinkedIn)" }, 
];

const STYLE_PRESET_OPTIONS: SelectOption[] = Object.values(StylePreset).map((preset) => ({
  value: preset,
  label: preset.charAt(0).toUpperCase() + preset.slice(1).toLowerCase(),
}));

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

type PexelsPhoto = {
  id: number;
  alt?: string;
  src?: {
    medium?: string;
    large?: string;
    large2x?: string;
    original?: string;
  };
  photographer?: string;
  photographer_url?: string;
  url?: string;
};

type PexelsSearchResponse = {
  photos?: PexelsPhoto[];
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

function dedupePexelsPhotos(photos: PexelsPhoto[]) {
  const seen = new Set<number>();
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

function buildImageFingerprint(
  source: "device" | "unsplash" | "pexels" | "existing" | undefined,
  imageUrl: string | undefined,
) {
  return `${source ?? "none"}|${imageUrl ?? ""}`;
}

function formatUtcOffsetLabel(offsetMinutes: number) {
  const totalMinutes = -offsetMinutes;
  const sign = totalMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(totalMinutes);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const minutes = String(absoluteMinutes % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}

function formatOffsetDateTime(localDate: Date) {
  const year = localDate.getFullYear();
  const month = String(localDate.getMonth() + 1).padStart(2, "0");
  const day = String(localDate.getDate()).padStart(2, "0");
  const hours = String(localDate.getHours()).padStart(2, "0");
  const minutes = String(localDate.getMinutes()).padStart(2, "0");
  const seconds = String(localDate.getSeconds()).padStart(2, "0");
  const offset = formatUtcOffsetLabel(localDate.getTimezoneOffset());
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offset.slice(3)}`;
}

// ─── MediaGrid ───────────────────────────────────────────────────────────────
// Renders image/video previews in a LinkedIn-style grid.
// Pass onRemove to enable per-item delete buttons (editor use only).
function MediaGrid({
  srcs,
  type,
  onRemove,
}: {
  srcs: string[];
  type: "images" | "video" | null;
  onRemove?: (index: number) => void;
}) {
  if (!srcs.length || !type) return null;

  const removeBtn = (i: number) =>
    onRemove ? (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(i); }}
        className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white opacity-0 transition group-hover/cell:opacity-100 hover:bg-black/80"
        aria-label={`Remove image ${i + 1}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    ) : null;

  const imgCls = "h-full w-full object-cover";

  if (type === "video") {
    return (
      <div className="relative mt-4 overflow-hidden rounded-xl border border-[var(--color-border)] group/cell">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          src={srcs[0]}
          controls
          className="max-h-[360px] w-full object-contain"
        />
        {removeBtn(0)}
      </div>
    );
  }

  const count = srcs.length;
  const shown = srcs.slice(0, 4);
  const overflow = count - 4;

  if (count === 1) {
    return (
      <div className="relative mt-4 overflow-hidden rounded-xl border border-[var(--color-border)] group/cell">
        <img
          src={srcs[0]}
          alt="Media 1"
          referrerPolicy="no-referrer"
          className="max-h-[360px] w-full object-cover"
        />
        {removeBtn(0)}
      </div>
    );
  }

  if (count === 2) {
    return (
      <div className="mt-4 grid grid-cols-2 gap-0.5 overflow-hidden rounded-xl border border-[var(--color-border)]">
        {shown.map((src, i) => (
          <div key={i} className="relative aspect-[4/3] overflow-hidden group/cell">
            <img src={src} alt={`Media ${i + 1}`} referrerPolicy="no-referrer" className={imgCls} />
            {removeBtn(i)}
          </div>
        ))}
      </div>
    );
  }

  if (count === 3) {
    return (
      <div
        className="mt-4 grid gap-0.5 overflow-hidden rounded-xl border border-[var(--color-border)]"
        style={{ gridTemplateColumns: "60% 40%", gridTemplateRows: "1fr 1fr" }}
      >
        <div className="relative row-span-2 overflow-hidden group/cell" style={{ minHeight: 220 }}>
          <img src={srcs[0]} alt="Media 1" referrerPolicy="no-referrer" className={imgCls} style={{ height: "100%" }} />
          {removeBtn(0)}
        </div>
        {[srcs[1], srcs[2]].map((src, i) => (
          <div key={i} className="relative aspect-[4/3] overflow-hidden group/cell">
            <img src={src} alt={`Media ${i + 2}`} referrerPolicy="no-referrer" className={imgCls} />
            {removeBtn(i + 1)}
          </div>
        ))}
      </div>
    );
  }

  // 4+ images: 2×2 grid, last cell gets "+N more" overlay
  return (
    <div className="mt-4 grid grid-cols-2 gap-0.5 overflow-hidden rounded-xl border border-[var(--color-border)]">
      {shown.map((src, i) => {
        const isLast = i === 3 && overflow > 0;
        return (
          <div key={i} className="relative aspect-square overflow-hidden group/cell">
            <img src={src} alt={`Media ${i + 1}`} referrerPolicy="no-referrer" className={imgCls} />
            {isLast && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                <span className="text-2xl font-bold text-white">+{overflow + 1}</span>
              </div>
            )}
            {!isLast && removeBtn(i)}
          </div>
        );
      })}
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

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
  const [stylePreset, setStylePreset] = useState<StylePreset>(StylePreset.PROFESSIONAL);
  const [content, setContent] = useState(initialContent ?? "");
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [mediaPreviews, setMediaPreviews] = useState<string[]>(
    initialImageUrl ? [initialImageUrl] : [],
  );
  const [mediaSources, setMediaSources] = useState<Array<"device" | "unsplash" | "pexels" | "existing">>(
    initialImageUrl ? ["existing"] : [],
  );
  const [mediaType, setMediaType] = useState<"images" | "video" | null>(null);
  const [mediaSource, setMediaSource] = useState<"device" | "unsplash" | "pexels" | "existing" | undefined>(
    initialImageUrl ? "existing" : undefined,
  );
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [resolvedLinkedinPreviewUrls, setResolvedLinkedinPreviewUrls] = useState<string[]>([]);
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
  const [selectedMediaSource, setSelectedMediaSource] = useState<"device" | "unsplash" | "pexels">("device");
  const [isUnsplashModalOpen, setIsUnsplashModalOpen] = useState(false);
  const [isPexelsModalOpen, setIsPexelsModalOpen] = useState(false);
  const [isSchedulePopoverOpen, setIsSchedulePopoverOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [unsplashQuery, setUnsplashQuery] = useState(DEFAULT_UNSPLASH_QUERY);
  const [unsplashCommittedQuery, setUnsplashCommittedQuery] = useState(DEFAULT_UNSPLASH_QUERY);
  const [unsplashImages, setUnsplashImages] = useState<UnsplashPhoto[]>([]);
  const [unsplashPage, setUnsplashPage] = useState(0);
  const [unsplashHasMore, setUnsplashHasMore] = useState(true);
  const [unsplashIsLoading, setUnsplashIsLoading] = useState(false);
  const [unsplashError, setUnsplashError] = useState<string | null>(null);
  const [pexelsQuery, setPexelsQuery] = useState(DEFAULT_UNSPLASH_QUERY);
  const [pexelsCommittedQuery, setPexelsCommittedQuery] = useState(DEFAULT_UNSPLASH_QUERY);
  const [pexelsImages, setPexelsImages] = useState<PexelsPhoto[]>([]);
  const [pexelsPage, setPexelsPage] = useState(0);
  const [pexelsHasMore, setPexelsHasMore] = useState(true);
  const [pexelsIsLoading, setPexelsIsLoading] = useState(false);
  const [pexelsError, setPexelsError] = useState<string | null>(null);
  const [postMediaUrns, setPostMediaUrns] = useState<string[]>([]);
  const [isResolvingPreviewMedia, setIsResolvingPreviewMedia] = useState(false);
  const [hasUserSelectedStockImage, setHasUserSelectedStockImage] = useState(false);
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false);

  const modalRef = useRef<HTMLDivElement | null>(null);
  const aiPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const mediaMenuRef = useRef<HTMLDivElement | null>(null);
  const schedulePopoverRef = useRef<HTMLDivElement | null>(null);
  const scheduleDateInputRef = useRef<HTMLInputElement | null>(null);
  const unsplashModalRef = useRef<HTMLDivElement | null>(null);
  const unsplashScrollRef = useRef<HTMLDivElement | null>(null);
  const unsplashSentinelRef = useRef<HTMLDivElement | null>(null);
  const unsplashInFlightRef = useRef<string>("");
  const pexelsModalRef = useRef<HTMLDivElement | null>(null);
  const pexelsScrollRef = useRef<HTMLDivElement | null>(null);
  const pexelsSentinelRef = useRef<HTMLDivElement | null>(null);
  const pexelsInFlightRef = useRef<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const keepEditingButtonRef = useRef<HTMLButtonElement | null>(null);
  const mediaErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks all blob: object URLs created so we can revoke on unmount
  const objectUrlsRef = useRef<Set<string>>(new Set());
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
  const initialContentRef = useRef(initialContent ?? "");
  const initialImageFingerprintRef = useRef(initialImageUrl ?? "");
  const POLL_INTERVAL_MS = 6000;
  const POLL_TIMEOUT_MS = 240000;
  const unsplashAccessKey = process.env.NEXT_PUBLIC_UNSPLASH_ACCESS_KEY?.trim() ?? "";
  const pexelsAccessKey = process.env.NEXT_PUBLIC_PEXELS_ACCESS_KEY?.trim() ?? "";
  const userTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );
  const timezoneLabel = useMemo(
    () => `${formatUtcOffsetLabel(new Date().getTimezoneOffset())} (${userTimezone})`,
    [userTimezone],
  );

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
    setStylePreset(StylePreset.PROFESSIONAL);
    setContent(initialContent ?? "");
    // Revoke any previously generated blob: URLs
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
    setMediaFiles([]);
    setMediaPreviews(initialImageUrl ? [initialImageUrl] : []);
    setMediaSources(initialImageUrl ? ["existing"] : []);
    setMediaType(null);
    setMediaSource(initialImageUrl ? "existing" : undefined);
    setMediaError(null);
    setResolvedLinkedinPreviewUrls([]);
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
    setIsPexelsModalOpen(false);
    setIsSchedulePopoverOpen(false);
    setScheduleDate("");
    setScheduleTime("");
    setScheduleError(null);
    setUnsplashQuery(DEFAULT_UNSPLASH_QUERY);
    setUnsplashCommittedQuery(DEFAULT_UNSPLASH_QUERY);
    setUnsplashImages([]);
    setUnsplashPage(0);
    setUnsplashHasMore(true);
    setUnsplashIsLoading(false);
    setUnsplashError(null);
    setPexelsQuery(DEFAULT_UNSPLASH_QUERY);
    setPexelsCommittedQuery(DEFAULT_UNSPLASH_QUERY);
    setPexelsImages([]);
    setPexelsPage(0);
    setPexelsHasMore(true);
    setPexelsIsLoading(false);
    setPexelsError(null);
    setPostMediaUrns([]);
    setIsResolvingPreviewMedia(false);
    setHasUserSelectedStockImage(false);
    setIsDiscardConfirmOpen(false);
    previewMediaFetchStateRef.current = { postId: null, status: "idle" };
    initialContentRef.current = initialContent ?? "";
    initialImageFingerprintRef.current = initialImageUrl ?? "";
    unsplashInFlightRef.current = "";
    pexelsInFlightRef.current = "";
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
    setIsPexelsModalOpen(false);
    setIsSchedulePopoverOpen(false);
    setScheduleError(null);
    setIsResolvingPreviewMedia(false);
    setResolvedLinkedinPreviewUrls([]);
    setIsDiscardConfirmOpen(false);
    previewMediaFetchStateRef.current = { postId: null, status: "idle" };
    activePreviewPostIdRef.current = null;
    previousEditPostIdRef.current = undefined;
    unsplashInFlightRef.current = "";
    pexelsInFlightRef.current = "";
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
    setResolvedLinkedinPreviewUrls([]);
    setIsResolvingPreviewMedia(false);
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
    setMediaFiles([]);
    setMediaPreviews(initialImageUrl ? [initialImageUrl] : []);
    setMediaSources(initialImageUrl ? ["existing"] : []);
    setMediaType(null);
    setMediaSource(initialImageUrl ? "existing" : undefined);
    setMediaError(null);
    setHasUserSelectedStockImage(false);
    setIsDiscardConfirmOpen(false);
    setIsSchedulePopoverOpen(false);
    setScheduleError(null);
    initialContentRef.current = initialContent ?? "";
    initialImageFingerprintRef.current = initialImageUrl ?? "";
  }, [initialContent, initialImageUrl, isOpen, mode, postId]);

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

  const requestClose = useCallback(() => {
    if (isSchedulePopoverOpen) {
      setIsSchedulePopoverOpen(false);
      setScheduleError(null);
      return;
    }
    const isContentDirty = content !== initialContentRef.current;
    const isImageDirty = mediaPreviews.join("|") !== initialImageFingerprintRef.current;
    const resolvedPostId = postId ?? activeDraftId ?? undefined;
    const shouldConfirmDiscard =
      phase === "editor" && Boolean(resolvedPostId) && (isContentDirty || isImageDirty);
    if (shouldConfirmDiscard) {
      setIsDiscardConfirmOpen(true);
      return;
    }
    onClose();
  }, [
    activeDraftId,
    content,
    mediaPreviews,
    isSchedulePopoverOpen,
    onClose,
    phase,
    postId,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isDiscardConfirmOpen) {
          event.preventDefault();
          setIsDiscardConfirmOpen(false);
          return;
        }
        if (isUnsplashModalOpen) {
          event.preventDefault();
          setIsUnsplashModalOpen(false);
          return;
        }
        if (isPexelsModalOpen) {
          event.preventDefault();
          setIsPexelsModalOpen(false);
          return;
        }
        if (isSchedulePopoverOpen) {
          event.preventDefault();
          setIsSchedulePopoverOpen(false);
          setScheduleError(null);
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
        requestClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const modal = isUnsplashModalOpen
        ? unsplashModalRef.current
        : isPexelsModalOpen
          ? pexelsModalRef.current
          : modalRef.current;
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
  }, [
    isDiscardConfirmOpen,
    isEmojiPickerOpen,
    isMediaMenuOpen,
    isOpen,
    isSchedulePopoverOpen,
    isPexelsModalOpen,
    isUnsplashModalOpen,
    requestClose,
  ]);

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
    if (!isDiscardConfirmOpen) {
      return;
    }
    const rafId = window.requestAnimationFrame(() => {
      keepEditingButtonRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [isDiscardConfirmOpen]);

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
    if (!isSchedulePopoverOpen) {
      return;
    }
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (schedulePopoverRef.current?.contains(target)) {
        return;
      }
      if (target instanceof Element && target.closest("[data-schedule-trigger='true']")) {
        return;
      }
      setIsSchedulePopoverOpen(false);
      setScheduleError(null);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isSchedulePopoverOpen]);

  useEffect(() => {
    if (!isSchedulePopoverOpen) {
      return;
    }
    const rafId = window.requestAnimationFrame(() => {
      scheduleDateInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [isSchedulePopoverOpen]);

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
    if (!isPexelsModalOpen || pexelsPage < 1) {
      return;
    }
    if (!pexelsAccessKey) {
      setPexelsError("Pexels access key is missing.");
      setPexelsHasMore(false);
      return;
    }

    const inFlightKey = `${pexelsCommittedQuery}:${pexelsPage}`;
    if (pexelsInFlightRef.current === inFlightKey) {
      return;
    }
    pexelsInFlightRef.current = inFlightKey;

    const controller = new AbortController();
    const query = pexelsCommittedQuery.trim() || DEFAULT_UNSPLASH_QUERY;
    const params = new URLSearchParams({
      query,
      page: String(pexelsPage),
      per_page: String(UNSPLASH_PAGE_SIZE),
    });

    setPexelsIsLoading(true);

    void (async () => {
      try {
        const response = await fetch(`https://api.pexels.com/v1/search?${params.toString()}`, {
          headers: {
            Authorization: pexelsAccessKey,
          },
          signal: controller.signal,
        });
        const payload = (await response.json()) as PexelsSearchResponse;
        if (!response.ok) {
          throw new Error("Unable to load Pexels images.");
        }

        const results = Array.isArray(payload?.photos)
          ? dedupePexelsPhotos(payload.photos)
          : [];

        setPexelsImages((current) =>
          pexelsPage === 1
            ? results
            : dedupePexelsPhotos([...current, ...results]),
        );
        setPexelsHasMore(results.length === UNSPLASH_PAGE_SIZE);
        setPexelsError(null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setPexelsError(
          error instanceof Error ? error.message : "Unable to load Pexels images.",
        );
        setPexelsHasMore(false);
      } finally {
        setPexelsIsLoading(false);
        if (pexelsInFlightRef.current === inFlightKey) {
          pexelsInFlightRef.current = "";
        }
      }
    })();

    return () => controller.abort();
  }, [isPexelsModalOpen, pexelsAccessKey, pexelsCommittedQuery, pexelsPage]);

  useEffect(() => {
    if (!isPexelsModalOpen || !pexelsHasMore || pexelsIsLoading) {
      return;
    }
    const root = pexelsScrollRef.current;
    const target = pexelsSentinelRef.current;
    if (!root || !target) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const isIntersecting = entries.some((entry) => entry.isIntersecting);
        if (!isIntersecting || pexelsInFlightRef.current) {
          return;
        }
        setPexelsPage((current) => current + 1);
      },
      {
        root,
        threshold: 0.2,
        rootMargin: "180px 0px",
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [isPexelsModalOpen, pexelsHasMore, pexelsIsLoading]);

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
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
      if (mediaErrorTimerRef.current) clearTimeout(mediaErrorTimerRef.current);
    };
  }, []);

  const charsUsed = content.length;
  const isNearLimit = charsUsed >= Math.floor(maxChars * 0.85);
  const isOverLimit = charsUsed > maxChars;
  const isContentDirty = content !== initialContentRef.current;
  const isImageDirty = mediaPreviews.join("|") !== initialImageFingerprintRef.current;
  const isDirty = isContentDirty || isImageDirty;
  const resolvedPostId = postId ?? activeDraftId ?? undefined;
  const canSaveDraft =
    phase === "editor" &&
    Boolean(resolvedPostId) &&
    isDirty &&
    !isOverLimit &&
    pendingAction === null;
  const hasContent = content.trim().length > 0;
  const hasPreviewContent = hasContent || mediaPreviews.length > 0 || resolvedLinkedinPreviewUrls.length > 0;
  const progressSegments = [0, 1, 2, 3].map((index) => {
    const segmentStart = index * 25;
    const segmentFill = ((progressPercent - segmentStart) / 25) * 100;
    return Math.max(0, Math.min(100, segmentFill));
  });

  const accountName = account.name?.trim() || "Connected account";
  const accountHeadline =
    account.headline?.trim() ||
    (account.provider === "LINKEDIN" ? "LinkedIn account" : "Connected account");
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
      requestClose();
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
        stylePreset,
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

  const MAX_MEDIA_SIZE = 200 * 1024 * 1024; // 200 MB
  const MAX_IMAGES = 20;

  const showMediaError = (msg: string) => {
    setMediaError(msg);
    if (mediaErrorTimerRef.current) clearTimeout(mediaErrorTimerRef.current);
    mediaErrorTimerRef.current = setTimeout(() => setMediaError(null), 4000);
  };

  const removeMedia = (index: number) => {
    const preview = mediaPreviews[index];
    const source = mediaSources[index];

    if (source === "device" && preview?.startsWith("blob:")) {
      URL.revokeObjectURL(preview);
      objectUrlsRef.current.delete(preview);
      // Remove the corresponding File (count device items before this index)
      const deviceIndexBefore = mediaSources.slice(0, index).filter((s) => s === "device").length;
      setMediaFiles((prev) => prev.filter((_, i) => i !== deviceIndexBefore));
    }

    const newPreviews = mediaPreviews.filter((_, i) => i !== index);
    const newSources = mediaSources.filter((_, i) => i !== index);
    setMediaPreviews(newPreviews);
    setMediaSources(newSources);

    if (newPreviews.length === 0) {
      setMediaType(null);
      setMediaSource(undefined);
      setHasUserSelectedStockImage(false);
    }
  };

  const handleFilesChange = (incoming: File[]) => {
    if (!incoming.length) return;

    // Determine incoming type
    const allImages = incoming.every(
      (f) => f.type === "image/jpeg" || f.type === "image/png",
    );
    const hasVideoIncoming = incoming.some((f) => f.type.startsWith("video/"));
    const incomingType: "images" | "video" = hasVideoIncoming ? "video" : "images";

    // Format validation
    if (!allImages && !hasVideoIncoming) {
      showMediaError("Only JPEG/PNG images or a single video are supported.");
      return;
    }
    if (hasVideoIncoming && incoming.length > 1) {
      showMediaError("Please select a single video file.");
      return;
    }
    if (incomingType === "images") {
      const badFormat = incoming.find(
        (f) => f.type !== "image/jpeg" && f.type !== "image/png",
      );
      if (badFormat) {
        showMediaError("Only JPEG and PNG images are supported.");
        return;
      }
    }

    // Type-mixing guard
    if (mediaType !== null && mediaType !== incomingType) {
      showMediaError(
        incomingType === "video"
          ? "Remove your images before adding a video."
          : "Remove the video before adding images.",
      );
      return;
    }

    // Count limit (images)
    if (incomingType === "images" && mediaPreviews.length + incoming.length > MAX_IMAGES) {
      showMediaError(`LinkedIn allows up to ${MAX_IMAGES} images per post.`);
      return;
    }

    // Size limit
    const bigFile = incoming.find((f) => f.size > MAX_MEDIA_SIZE);
    if (bigFile) {
      showMediaError(`"${bigFile.name}" exceeds the 200 MB file size limit.`);
      return;
    }

    // All valid — create object URLs and update state
    const newUrls = incoming.map((f) => URL.createObjectURL(f));
    newUrls.forEach((url) => objectUrlsRef.current.add(url));

    setMediaFiles((prev) => [...prev, ...incoming]);
    setMediaPreviews((prev) => [...prev, ...newUrls]);
    setMediaSources((prev) => [...prev, ...incoming.map(() => "device" as const)]);
    setMediaType(incomingType);
    setMediaSource("device");
    setMediaError(null);
    setResolvedLinkedinPreviewUrls([]);
    setHasUserSelectedStockImage(false);

    // Reset input so same file can be re-added after removal
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const openUnsplashModal = () => {
    setUnsplashQuery(DEFAULT_UNSPLASH_QUERY);
    setUnsplashCommittedQuery(DEFAULT_UNSPLASH_QUERY);
    setUnsplashImages([]);
    setUnsplashPage(1);
    setUnsplashHasMore(true);
    setUnsplashError(null);
    setIsPexelsModalOpen(false);
    setIsUnsplashModalOpen(true);
  };

  const openPexelsModal = () => {
    setPexelsQuery(DEFAULT_UNSPLASH_QUERY);
    setPexelsCommittedQuery(DEFAULT_UNSPLASH_QUERY);
    setPexelsImages([]);
    setPexelsPage(1);
    setPexelsHasMore(true);
    setPexelsError(null);
    setIsUnsplashModalOpen(false);
    setIsPexelsModalOpen(true);
  };

  const openSelectedMediaSource = () => {
    if (selectedMediaSource === "device") {
      fileInputRef.current?.click();
      return;
    }
    if (selectedMediaSource === "unsplash") {
      openUnsplashModal();
      return;
    }
    openPexelsModal();
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
    if (!selectedUrl) return;
    if (mediaType === "video") {
      showMediaError("Remove the video before adding images.");
      return;
    }
    if (mediaPreviews.length >= MAX_IMAGES) {
      showMediaError(`LinkedIn allows up to ${MAX_IMAGES} images per post.`);
      return;
    }
    setMediaPreviews((prev) => [...prev, selectedUrl]);
    setMediaSources((prev) => [...prev, "unsplash"]);
    setMediaType("images");
    setMediaSource("unsplash");
    setResolvedLinkedinPreviewUrls([]);
    setIsUnsplashModalOpen(false);
    setSelectedMediaSource("unsplash");
    setHasUserSelectedStockImage(true);
    window.requestAnimationFrame(() => editorRef.current?.focus());
  };

  const runPexelsSearch = () => {
    const query = pexelsQuery.trim() || DEFAULT_UNSPLASH_QUERY;
    setPexelsCommittedQuery(query);
    setPexelsImages([]);
    setPexelsPage(1);
    setPexelsHasMore(true);
    setPexelsError(null);
    pexelsInFlightRef.current = "";
  };

  const handleSelectPexelsPhoto = (photo: PexelsPhoto) => {
    const selectedUrl = photo.src?.large2x ?? photo.src?.large ?? photo.src?.medium ?? photo.src?.original;
    if (!selectedUrl) return;
    if (mediaType === "video") {
      showMediaError("Remove the video before adding images.");
      return;
    }
    if (mediaPreviews.length >= MAX_IMAGES) {
      showMediaError(`LinkedIn allows up to ${MAX_IMAGES} images per post.`);
      return;
    }
    setMediaPreviews((prev) => [...prev, selectedUrl]);
    setMediaSources((prev) => [...prev, "pexels"]);
    setMediaType("images");
    setMediaSource("pexels");
    setResolvedLinkedinPreviewUrls([]);
    setIsPexelsModalOpen(false);
    setSelectedMediaSource("pexels");
    setHasUserSelectedStockImage(true);
    window.requestAnimationFrame(() => editorRef.current?.focus());
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

    // Identify the scrollable container that holds the editor.
    const scrollContainer = editorElement.closest('.overflow-y-auto') as HTMLElement;

    // Changing height to auto causes layout shift and scroll jumping.
    // Store original scroll positions to restore them after resize.
    const scrollY = window.scrollY;
    const containerScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

    // Store selection range because setting height to auto resets it
    const selectionStart = editorElement.selectionStart;
    const selectionEnd = editorElement.selectionEnd;

    editorElement.style.height = "auto";
    editorElement.style.height = `${editorElement.scrollHeight}px`;

    window.scrollTo(0, scrollY);
    if (scrollContainer) {
      scrollContainer.scrollTop = containerScrollTop;
    }

    // Restore selection range
    if (document.activeElement === editorElement) {
      editorElement.setSelectionRange(selectionStart, selectionEnd);
    }
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

  /**
   * Resolves ALL LinkedIn media URNs in parallel (cache-first, then API).
   * Unlike resolveLinkedinMediaUrlFromCacheOrApi which stops at the first
   * success, this returns one URL per URN so multi-image posts preview correctly.
   */
  const resolveAllLinkedinMediaUrls = useCallback(
    async (urns: string[]): Promise<string[]> => {
      if (!onGetLinkedinImageByUrn) return [];

      const results = await Promise.all(
        urns.map(async (urn): Promise<string | null> => {
          const normalizedUrn = urn.trim();
          if (!normalizedUrn) return null;

          // Cache-first
          try {
            const cachedRaw = window.localStorage.getItem(normalizedUrn);
            if (cachedRaw) {
              const cached = JSON.parse(cachedRaw) as CachedLinkedinImage;
              if (
                typeof cached?.downloadUrl === "string" &&
                cached.downloadUrl.length > 0 &&
                typeof cached?.downloadUrlExpiresAt === "number" &&
                cached.downloadUrlExpiresAt > Date.now()
              ) {
                return cached.downloadUrl;
              }
            }
          } catch {
            // Fall through to API.
          }

          // API fetch
          try {
            const details = await onGetLinkedinImageByUrn(normalizedUrn);
            const resolvedUrl = details?.data?.downloadUrl;
            const resolvedExpiry = details?.data?.downloadUrlExpiresAt;
            if (typeof resolvedUrl === "string" && resolvedUrl.length > 0 && typeof resolvedExpiry === "number") {
              try {
                window.localStorage.setItem(
                  normalizedUrn,
                  JSON.stringify({
                    downloadUrl: resolvedUrl,
                    downloadUrlExpiresAt: resolvedExpiry,
                  } satisfies CachedLinkedinImage),
                );
              } catch {
                // Ignore write errors.
              }
              return resolvedUrl;
            }
          } catch {
            // Return null for this URN.
          }

          return null;
        }),
      );

      return results.filter((url): url is string => typeof url === "string" && url.length > 0);
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
            setResolvedLinkedinPreviewUrls([]);
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
      if (mediaPreviews.length === 0) {
        setResolvedLinkedinPreviewUrls([]);
      }
      return;
    }
    if (mediaFiles.length > 0 || hasUserSelectedStockImage || isResolvingPreviewMedia) {
      return;
    }

    let cancelled = false;
    const targetPostId = postId ?? null;
    const requestSeq = mediaResolveRequestSeqRef.current + 1;
    mediaResolveRequestSeqRef.current = requestSeq;

    const resolvePreviewMedia = async () => {
      setIsResolvingPreviewMedia(true);
      try {
        const resolvedUrls = await resolveAllLinkedinMediaUrls(postMediaUrns);
        if (
          !cancelled &&
          mediaResolveRequestSeqRef.current === requestSeq &&
          activePreviewPostIdRef.current === targetPostId &&
          resolvedUrls.length > 0 &&
          mediaFiles.length === 0 &&
          !hasUserSelectedStockImage
        ) {
          setResolvedLinkedinPreviewUrls(resolvedUrls);
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
    hasUserSelectedStockImage,
    mediaFiles,
    mediaPreviews,
    isOpen,
    isPreviewVisible,
    isResolvingPreviewMedia,
    postId,
    postMediaUrns,
    resolveAllLinkedinMediaUrls,
  ]);


  const getScheduledTimeValue = () => {
    if (!scheduleDate || !scheduleTime) {
      return { error: "Please select both date and time." } as const;
    }
    const [year, month, day] = scheduleDate.split("-").map((value) => Number(value));
    const [hours, minutes] = scheduleTime.split(":").map((value) => Number(value));
    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      !Number.isFinite(day) ||
      !Number.isFinite(hours) ||
      !Number.isFinite(minutes)
    ) {
      return { error: "Please provide a valid date and time." } as const;
    }

    const localDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
    if (
      Number.isNaN(localDate.getTime()) ||
      localDate.getFullYear() !== year ||
      localDate.getMonth() !== month - 1 ||
      localDate.getDate() !== day
    ) {
      return { error: "Please provide a valid date and time." } as const;
    }

    const minLeadTimeMs = 5 * 60 * 1000;
    if (localDate.getTime() < Date.now() + minLeadTimeMs) {
      return { error: "Choose a time at least 5 minutes in the future." } as const;
    }

    return { scheduledTime: formatOffsetDateTime(localDate) } as const;
  };

  const buildPayload = (
    overrides?: Partial<Pick<NewPostSubmitPayload, "scheduledTime" | "timezone">>,
  ): NewPostSubmitPayload => {
    // Split previews: device blobs vs. stock URLs
    const stockUrls = mediaPreviews.filter((_, i) => mediaSources[i] !== "device");
    return {
      mode,
      postId: resolvedPostId,
      content,
      mediaFiles: mediaFiles.length > 0 ? mediaFiles : undefined,
      mediaUrls: stockUrls.length > 0 ? stockUrls : undefined,
      mediaSource,
      mediaType: mediaType ?? undefined,
      aiPrompt,
      postType,
      ...overrides,
    };
  };

  const runAction = async (
    action: "publish" | "schedule" | "save",
    callback: (payload: NewPostSubmitPayload) => Promise<void> | void,
    payloadOverrides?: Partial<Pick<NewPostSubmitPayload, "scheduledTime" | "timezone">>,
  ) => {
    setPendingAction(action);
    try {
      await callback(buildPayload(payloadOverrides));
      if (action === "save") {
        initialContentRef.current = content;
        initialImageFingerprintRef.current = mediaPreviews.join("|");
      }
    } finally {
      setPendingAction(null);
    }
  };

  const handleConfirmSchedule = () => {
    const result = getScheduledTimeValue();
    if ("error" in result && result.error) {
      setScheduleError(result.error);
      return;
    }
    setScheduleError(null);
    setIsSchedulePopoverOpen(false);
    void runAction("schedule", onSchedule, {
      scheduledTime: result.scheduledTime,
      timezone: userTimezone,
    });
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
                  className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold transition ${isPreviewVisible
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
                onClick={requestClose}
                className="grid h-10 w-10 place-items-center rounded-full text-[var(--color-text-secondary)] transition hover:bg-[var(--color-background)] hover:text-[var(--color-text-primary)]"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </header>

          <div
            className={`grid min-h-0 flex-1 ${isPreviewVisible ? "grid-cols-1 lg:grid-cols-3" : "grid-cols-1"
              }`}
          >
            <section
              className={`min-h-0 overflow-y-auto border-b border-[var(--color-border)] px-5 py-5 sm:px-6 ${isPreviewVisible ? "lg:col-span-2 lg:border-b-0 lg:border-r" : "lg:border-b-0"
                }`}
            >
              {phase === "ai_prompt" ? (
                <div className="mx-auto flex h-full max-w-4xl flex-col">
                  <div className="mb-6 mt-4">
                    <h3 className="text-xl font-semibold text-[var(--color-text-primary)]">What would you like to post about?</h3>
                    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">For the best results, use a descriptive prompt about the subject, tone, and goals of your post.</p>
                  </div>
                  <div className="flex flex-col rounded-[2rem] border border-[var(--color-border)] bg-white p-3 shadow-sm transition-shadow focus-within:border-[var(--color-primary)]/40 focus-within:ring-4 focus-within:ring-[var(--color-primary)]/5 sm:p-4">
                    <textarea
                      ref={aiPromptRef}
                      value={aiPrompt}
                      onChange={(event) => {
                        setAiPrompt(event.target.value);
                        // Auto-resize
                        event.target.style.height = "auto";
                        event.target.style.height = `${event.target.scrollHeight}px`;
                        if (promptError) {
                          setPromptError(null);
                        }
                      }}
                      rows={2}
                      placeholder="Describe the post you want to create..."
                      className="max-h-[50vh] min-h-[56px] w-full resize-none border-none bg-transparent px-2 py-2 text-base text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]"
                    />
                    {promptError ? (
                      <p className="my-2 px-2 text-sm font-medium text-rose-600">{promptError}</p>
                    ) : null}
                    <div className="mt-3 flex items-end justify-between gap-3 px-1 pt-2 border-t border-[var(--color-border)]/50">
                      <div className="flex flex-wrap items-center gap-2">
                        <CustomSelect
                          value={postType}
                          onChange={(value) => setPostType(value as "quickPostLinkedin" | "insightPostLinkedin")}
                          options={POST_TYPE_OPTIONS}
                          className="min-w-[190px]"
                          dropdownHeader="Content Type"
                        />
                        <CustomSelect
                          value={stylePreset}
                          onChange={(value) => setStylePreset(value as StylePreset)}
                          options={STYLE_PRESET_OPTIONS}
                          className="min-w-[150px]"
                          dropdownHeader="Style / Tone"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void handleGenerate();
                        }}
                        disabled={pendingAction !== null || !aiPrompt.trim()}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
                        aria-label="Generate draft"
                      >
                        <ArrowUp className="h-5 w-5" />
                      </button>
                    </div>
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
                            onChange={(event) => {
                              setContent(event.target.value);
                              syncEditorSelection();
                            }}
                            placeholder="Write your post..."
                            className="min-h-[260px] w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[15px] leading-9 text-[var(--color-text-primary)] outline-none placeholder:text-[#6d7482]"
                          />
                        </div>
                      </div>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,video/*"
                        multiple
                        className="hidden"
                        onChange={(event) =>
                          handleFilesChange(Array.from(event.target.files ?? []))
                        }
                      />

                      {/* ── Thumbnail strip (editor only) ── */}
                      {mediaPreviews.length > 0 && (
                        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                          {mediaPreviews.map((src, i) => (
                            <div
                              key={i}
                              className="group/thumb relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-[#d6dae3] bg-[#f2f4f9]"
                            >
                              {mediaType === "video" ? (
                                /* eslint-disable-next-line jsx-a11y/media-has-caption */
                                <video
                                  src={src}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <img
                                  src={src}
                                  alt={`Media ${i + 1}`}
                                  referrerPolicy="no-referrer"
                                  className="h-full w-full object-cover"
                                />
                              )}
                              <button
                                type="button"
                                onClick={() => removeMedia(i)}
                                className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover/thumb:bg-black/40 group-hover/thumb:opacity-100"
                                aria-label={`Remove media ${i + 1}`}
                              >
                                <X className="h-4 w-4 text-white drop-shadow" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="border-t border-[#dbe0ea] px-4 py-3 sm:px-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-col gap-1.5">
                          <div className="relative flex items-center gap-1">
                            <button
                              type="button"
                              onClick={openSelectedMediaSource}
                              disabled={mediaType === "images" && mediaPreviews.length >= MAX_IMAGES}
                              aria-label="Upload media"
                              data-media-trigger="true"
                              title="Add up to 20 images or 1 video"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-primary)] transition hover:bg-[#f2f4f9] disabled:pointer-events-none disabled:opacity-40"
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
                                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition hover:bg-[#f2f4f9] ${selectedMediaSource === "device"
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
                                className={`mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition hover:bg-[#f2f4f9] ${selectedMediaSource === "unsplash"
                                  ? "bg-[#eef3ff] text-[#1e40af]"
                                  : "text-[var(--color-text-primary)]"
                                  }`}
                              >
                                <img src="/unsplash.svg" alt="" aria-hidden="true" className="h-4 w-4" />
                                <span>Browse Unsplash</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setSelectedMediaSource("pexels");
                                  setIsMediaMenuOpen(false);
                                  openPexelsModal();
                                }}
                                className={`mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition hover:bg-[#f2f4f9] ${selectedMediaSource === "pexels"
                                  ? "bg-[#eef3ff] text-[#1e40af]"
                                  : "text-[var(--color-text-primary)]"
                                  }`}
                              >
                                <img src="/pexels.svg" alt="" aria-hidden="true" className="h-4 w-4" />
                                <span>Browse Pexels</span>
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
                          {/* Media count + error */}
                          {mediaPreviews.length > 0 && (
                            <p className={`text-[11px] font-medium ${mediaPreviews.length >= MAX_IMAGES ? "text-rose-500" : "text-[var(--color-text-secondary)]"}`}>
                              {mediaType === "video" ? "1 video" : `${mediaPreviews.length}/${MAX_IMAGES} images`}
                            </p>
                          )}
                          {mediaError && (
                            <p className="text-[11px] font-medium text-rose-500">{mediaError}</p>
                          )}
                          {!mediaPreviews.length && !mediaError && (
                            <p className="text-[11px] text-[var(--color-text-secondary)]">
                              {mediaType === "video" ? "1 video · max 200 MB" : "JPEG/PNG · up to 20 images or 1 video · 200 MB each"}
                            </p>
                          )}
                        </div>
                        <span
                          className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${isOverLimit
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
                  <div className="flex items-start gap-2.5">
                    <UserAvatar
                      initials={accountInitials}
                      avatarUrl={account.avatarUrl}
                      sizeClass="h-12 w-12"
                      textClass="text-sm"
                    />
                    <div className="min-w-0 flex-1 pt-0">
                      <p className="truncate text-[20px] font-semibold leading-6 text-[#1f1f1f]">
                        {accountName}
                      </p>
                      <p className="mt-0 truncate text-[13px] font-medium leading-5 text-[#666666]">
                        {accountHeadline}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1 text-[13px] leading-5 text-[#666666]">
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
                      {mediaPreviews.length > 0 ? (
                        <MediaGrid srcs={mediaPreviews} type={mediaType} />
                      ) : resolvedLinkedinPreviewUrls.length > 0 ? (
                        <MediaGrid
                          srcs={resolvedLinkedinPreviewUrls}
                          type="images"
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
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${isOverLimit
                ? "border-rose-200 bg-rose-50 text-rose-600"
                : isNearLimit
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)]"
                }`}
            >
              {charsUsed}/{maxChars}
            </span>
            <div className="relative flex flex-wrap items-center gap-2">
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
                onClick={() => {
                  setScheduleError(null);
                  setIsSchedulePopoverOpen(true);
                }}
                data-schedule-trigger="true"
                aria-haspopup="dialog"
                aria-expanded={isSchedulePopoverOpen}
                aria-controls="schedule-popover"
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
              {isSchedulePopoverOpen ? (
                <div
                  id="schedule-popover"
                  ref={schedulePopoverRef}
                  role="dialog"
                  aria-label="Schedule post"
                  className="absolute bottom-full right-0 z-[72] mb-3 w-[min(92vw,380px)] rounded-2xl border border-[#d6dae3] bg-white p-4 shadow-[0_20px_44px_-28px_rgba(15,23,42,0.45)]"
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#eef3ff] text-[#3451d1]">
                      <CalendarClock className="h-4 w-4" />
                    </span>
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">Schedule Post</p>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
                        Date
                      </span>
                      <input
                        ref={scheduleDateInputRef}
                        type="date"
                        value={scheduleDate}
                        onChange={(event) => setScheduleDate(event.target.value)}
                        className="h-11 w-full rounded-xl border border-[#cfd5e1] bg-white px-3 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-[#5575F5] focus:ring-2 focus:ring-[#5575F5]/20"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
                        Time
                      </span>
                      <input
                        type="time"
                        value={scheduleTime}
                        onChange={(event) => setScheduleTime(event.target.value)}
                        className="h-11 w-full rounded-xl border border-[#cfd5e1] bg-white px-3 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-[#5575F5] focus:ring-2 focus:ring-[#5575F5]/20"
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#e2e7f2] bg-[#f7f9ff] px-3 py-2 text-xs font-medium text-[#445065]">
                    <Clock3 className="h-4 w-4 text-[#5575F5]" />
                    <span>{timezoneLabel}</span>
                  </div>
                  {scheduleError ? (
                    <p className="mt-2 text-xs font-medium text-rose-600">{scheduleError}</p>
                  ) : null}
                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsSchedulePopoverOpen(false);
                        setScheduleError(null);
                      }}
                      className="inline-flex items-center rounded-full border border-[#d4dae6] bg-white px-4 py-2 text-xs font-semibold text-[var(--color-text-secondary)] transition hover:text-[var(--color-text-primary)]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmSchedule}
                      className="inline-flex items-center rounded-full bg-[var(--color-secondary)] px-4 py-2 text-xs font-semibold text-white transition hover:brightness-95"
                    >
                      Confirm Schedule
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </footer>
        </div>
        {isDiscardConfirmOpen ? (
          <div className="fixed inset-0 z-[85] flex items-center justify-center bg-[#12111A]/55 px-3 py-4 sm:px-6">
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="discard-changes-title"
              aria-describedby="discard-changes-description"
              className="w-full max-w-[560px] overflow-hidden rounded-2xl bg-white shadow-[0_28px_90px_-45px_rgba(15,23,42,0.55)]"
            >
              <div className="px-6 py-7 sm:px-7 sm:py-8">
                <h3
                  id="discard-changes-title"
                  className="text-3xl font-semibold leading-tight text-[#1f2328] sm:text-4xl"
                >
                  Discard Changes?
                </h3>
                <p
                  id="discard-changes-description"
                  className="mt-4 text-base leading-relaxed text-[#25282d] sm:text-lg"
                >
                  You&apos;ll permanently lose any changes you&apos;ve made
                </p>
              </div>
              <div className="flex items-center justify-end gap-3 border-t border-[#d6dae3] px-6 py-4 sm:px-7 sm:py-5">
                <button
                  ref={keepEditingButtonRef}
                  type="button"
                  onClick={() => setIsDiscardConfirmOpen(false)}
                  className="inline-flex items-center rounded-xl border-2 border-[#4c6ef5] bg-white px-5 py-2.5 text-base font-semibold text-[#1f2328] transition hover:bg-[#f7f9ff] sm:text-lg"
                >
                  Keep Editing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsDiscardConfirmOpen(false);
                    onClose();
                  }}
                  className="inline-flex items-center rounded-xl bg-[#e3345e] px-5 py-2.5 text-base font-semibold text-white transition hover:brightness-95 sm:text-lg"
                >
                  Discard Changes
                </button>
              </div>
            </div>
          </div>
        ) : null}
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
        {isPexelsModalOpen ? (
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-[#12111A]/40 px-3 py-4 backdrop-blur-[1px] sm:px-6"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setIsPexelsModalOpen(false);
              }
            }}
          >
            <div
              ref={pexelsModalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="pexels-modal-title"
              className="flex h-[min(90vh,860px)] w-full max-w-[1280px] flex-col rounded-2xl border border-[#d6dae3] bg-white shadow-[0_28px_90px_-45px_rgba(15,23,42,0.55)]"
            >
              <header className="flex items-center justify-between border-b border-[#dbe0ea] px-5 py-4">
                <div className="flex items-center gap-3">
                  <img src="/pexels.svg" alt="" aria-hidden="true" className="h-5 w-5" />
                  <h3 id="pexels-modal-title" className="text-[32px] font-semibold text-[var(--color-text-primary)]">
                    Pexels
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPexelsModalOpen(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition hover:bg-[#f2f4f9] hover:text-[var(--color-text-primary)]"
                  aria-label="Close Pexels search"
                >
                  <X className="h-5 w-5" />
                </button>
              </header>

              <div className="flex items-center gap-3 border-b border-[#dbe0ea] px-5 py-4">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
                  <input
                    type="text"
                    value={pexelsQuery}
                    onChange={(event) => setPexelsQuery(event.target.value)}
                    placeholder="Search free high resolution photos"
                    className="h-12 w-full rounded-lg border border-[#cfd5e1] bg-white pl-10 pr-3 text-base text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/15"
                  />
                </div>
                <button
                  type="button"
                  onClick={runPexelsSearch}
                  className="inline-flex h-12 items-center justify-center rounded-lg bg-[#2f54eb] px-6 text-base font-semibold text-white transition hover:brightness-95"
                >
                  Search
                </button>
              </div>

              <div ref={pexelsScrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {pexelsError ? (
                  <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {pexelsError}
                  </p>
                ) : null}
                {!pexelsIsLoading && !pexelsError && pexelsImages.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-secondary)]">No images found. Try another search.</p>
                ) : null}
                <div className="columns-1 gap-5 md:columns-2 lg:columns-3">
                  {pexelsImages.map((photo) => {
                    const previewUrl = photo.src?.medium ?? photo.src?.large ?? photo.src?.large2x ?? photo.src?.original;
                    const creatorName = photo.photographer || "Unknown creator";
                    const creatorUrl = photo.photographer_url || photo.url || "https://www.pexels.com";
                    const altText = photo.alt?.trim() || `Pexels image by ${creatorName}`;

                    return (
                      <article key={photo.id} className="mb-5 break-inside-avoid">
                        <button
                          type="button"
                          onClick={() => handleSelectPexelsPhoto(photo)}
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
                            href="https://www.pexels.com"
                            target="_blank"
                            rel="noreferrer noopener"
                            className="underline underline-offset-2 hover:text-[var(--color-text-primary)]"
                          >
                            Pexels
                          </a>
                        </p>
                      </article>
                    );
                  })}
                </div>
                <div ref={pexelsSentinelRef} className="h-8 w-full" />
                {pexelsIsLoading ? (
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
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      className="h-4 w-4 shrink-0"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M3 12h18M12 3c2.5 2.5 4 5.7 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.7-4-9s1.5-6.5 4-9z" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
