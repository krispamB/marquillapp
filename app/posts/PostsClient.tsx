"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  CalendarDays,
  CircleEllipsis,
  Edit3,
  LayoutDashboard,
  PenSquare,
  Search,
  Tags,
  TrendingUp,
} from "lucide-react";
import Sidebar from "../dashboard/Sidebar";
import NewPostModal, {
  type NewDraftGeneratePayload,
  type NewDraftGenerateResult,
  type NewPostSubmitPayload,
} from "../dashboard/NewPostModal";
import {
  Card,
  ConnectAccountCta,
  PillButton,
  StatusTag,
  UserAvatar,
} from "../dashboard/components";
import { useNewPostModal } from "../dashboard/useNewPostModal";
import type {
  ConnectedAccount,
  CreateDraftRequest,
  CreateDraftResponse,
  DashboardPost,
  DashboardPostsResponse,
  DraftStatusResponse,
  ImageUploadResponse,
  LinkedinAuthUrlResponse,
  LinkedinImageDetailsResponse,
  PostDetailResponse,
  PublishPostResponse,
  SchedulePostResponse,
  UpdatePostResponse,
  UserProfile,
} from "../lib/types";

type PostTab = "DRAFT" | "SCHEDULED" | "PUBLISHED";
type PostsViewMode = "list" | "calendar";
type GroupedPosts = { label: string; dateKey: string; items: DashboardPost[] };

const navItems = [
  {
    label: "Overview",
    active: false,
    href: "/dashboard",
    icon: <LayoutDashboard className="h-4 w-4" />,
  },
  { label: "Posts", active: true, href: "/posts", icon: <PenSquare className="h-4 w-4" /> },
  { label: "Calendar", active: false, disabled: true, icon: <CalendarClock className="h-4 w-4" /> },
  { label: "Analytics", active: false, disabled: true, icon: <TrendingUp className="h-4 w-4" /> },
];

function getInitials(name: string, email: string) {
  const cleaned = name.trim();
  if (cleaned.length > 0) {
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function parseUtcDate(value?: string) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toYearMonth(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function normalizeStatus(status?: string): PostTab {
  const normalized = String(status ?? "").toUpperCase();
  if (normalized === "SCHEDULED") {
    return "SCHEDULED";
  }
  if (normalized === "PUBLISHED") {
    return "PUBLISHED";
  }
  return "DRAFT";
}

function getPostPrimaryDate(post: DashboardPost) {
  return parseUtcDate(post.updatedAt) ?? parseUtcDate(post.createdAt) ?? parseUtcDate(post.scheduledAt);
}

function formatTimelineTime(isoDate?: string) {
  const date = parseUtcDate(isoDate);
  if (!date) {
    return "--";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatRelativeUpdateLabel(isoDate?: string) {
  const date = parseUtcDate(isoDate);
  if (!date) {
    return "Recently";
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  const hourMs = 1000 * 60 * 60;
  const dayMs = hourMs * 24;
  if (diffMs < dayMs) {
    const hours = Math.max(1, Math.floor(diffMs / hourMs));
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (diffMs < dayMs * 2) {
    return "Yesterday";
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDateGroupLabel(date: Date, now: Date) {
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nowOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((nowOnly.getTime() - dateOnly.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return "Today";
  }
  if (diffDays === 1) {
    return "Yesterday";
  }

  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function getTitleFromContent(content?: string) {
  if (!content) {
    return "Untitled post";
  }
  const firstNonEmptyLine =
    content
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  const rawTitle = firstNonEmptyLine || content.trim();
  if (!rawTitle) {
    return "Untitled post";
  }
  return rawTitle.length > 180 ? `${rawTitle.slice(0, 177)}...` : rawTitle;
}

function buildMonthGrid(baseDate: Date) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const cells: Array<{ day: number | null; isToday: boolean }> = [];
  const today = new Date();

  for (let i = 0; i < startOffset; i += 1) {
    cells.push({ day: null, isToday: false });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const isToday =
      today.getFullYear() === year &&
      today.getMonth() === month &&
      today.getDate() === day;
    cells.push({ day, isToday });
  }

  const totalCells = Math.ceil(cells.length / 7) * 7;
  while (cells.length < totalCells) {
    cells.push({ day: null, isToday: false });
  }

  return cells;
}

export default function PostsClient({
  user,
  connectedAccounts,
  primaryAccountId,
}: {
  user: UserProfile;
  connectedAccounts: ConnectedAccount[];
  primaryAccountId?: string;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [connectFeedback, setConnectFeedback] = useState<string | null>(null);
  const [isConnectingLinkedIn, setIsConnectingLinkedIn] = useState(false);
  const [isConnectMenuOpen, setIsConnectMenuOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(
    primaryAccountId ?? connectedAccounts[0]?.id,
  );
  const [posts, setPosts] = useState<DashboardPost[]>([]);
  const [isPostsLoading, setIsPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PostTab>("DRAFT");
  const [viewMode, setViewMode] = useState<PostsViewMode>("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedResearchPostIds, setExpandedResearchPostIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [generatedDraftId, setGeneratedDraftId] = useState<string | null>(null);
  const { state: newPostModalState, openCreate, openEdit, close: closeNewPostModal } =
    useNewPostModal();
  const connectMenuBoundaryRef = useRef<HTMLDivElement | null>(null);
  const popupWatcherRef = useRef<number | null>(null);
  const now = useMemo(() => new Date(), []);
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3500/api/v1";

  const initials = getInitials(user.name, user.email);
  const hasConnectedAccounts = connectedAccounts.length > 0 && Boolean(selectedAccountId);
  const selectedConnectedAccount = useMemo(
    () => connectedAccounts.find((account) => account.id === selectedAccountId) ?? connectedAccounts[0],
    [connectedAccounts, selectedAccountId],
  );
  const monthLabel = now.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  const postCounts = useMemo(
    () =>
      posts.reduce<Record<PostTab, number>>(
        (acc, post) => {
          acc[normalizeStatus(post.status)] += 1;
          return acc;
        },
        { DRAFT: 0, SCHEDULED: 0, PUBLISHED: 0 },
      ),
    [posts],
  );

  const filteredPosts = useMemo(() => {
    const trimmedQuery = searchQuery.trim().toLowerCase();
    return posts
      .filter((post) => normalizeStatus(post.status) === activeTab)
      .filter((post) => {
        if (!trimmedQuery) {
          return true;
        }
        return String(post.content ?? "").toLowerCase().includes(trimmedQuery);
      });
  }, [activeTab, posts, searchQuery]);

  const groupedPosts = useMemo<GroupedPosts[]>(() => {
    const sorted = [...filteredPosts].sort((a, b) => {
      const aTime = getPostPrimaryDate(a)?.getTime() ?? 0;
      const bTime = getPostPrimaryDate(b)?.getTime() ?? 0;
      return bTime - aTime;
    });

    const groups = new Map<string, GroupedPosts>();
    for (const post of sorted) {
      const date = getPostPrimaryDate(post);
      const dateKey = date ? date.toISOString().slice(0, 10) : "no-date";
      if (!groups.has(dateKey)) {
        groups.set(dateKey, {
          label: date ? formatDateGroupLabel(date, now) : "Undated",
          dateKey,
          items: [],
        });
      }
      groups.get(dateKey)?.items.push(post);
    }

    return [...groups.values()];
  }, [filteredPosts, now]);

  const monthGrid = useMemo(() => buildMonthGrid(now), [now]);

  const scheduledDaysInCurrentMonth = useMemo(() => {
    const days = new Set<number>();
    for (const post of posts) {
      if (normalizeStatus(post.status) !== "SCHEDULED") {
        continue;
      }
      const date = parseUtcDate(post.scheduledAt);
      if (!date) {
        continue;
      }
      if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) {
        days.add(date.getDate());
      }
    }
    return days;
  }, [now, posts]);

  const upcomingScheduledPosts = useMemo(() => {
    const nowTs = Date.now();
    return posts
      .filter((post) => normalizeStatus(post.status) === "SCHEDULED")
      .map((post) => {
        const date = parseUtcDate(post.scheduledAt);
        return date ? { ...post, scheduledDate: date } : null;
      })
      .filter((post): post is DashboardPost & { scheduledDate: Date } => post !== null)
      .filter((post) => post.scheduledDate.getTime() >= nowTs)
      .sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime())
      .slice(0, 6);
  }, [posts]);

  const loadPosts = useCallback(
    async (signal: AbortSignal) => {
      if (!selectedAccountId) {
        setPosts([]);
        setPostsError(null);
        setIsPostsLoading(false);
        return;
      }

      setIsPostsLoading(true);
      setPostsError(null);

      try {
        const month = toYearMonth(new Date());
        const query = new URLSearchParams({
          accountConnected: selectedAccountId,
          month,
        });

        const response = await fetch(`${apiBase}/posts?${query.toString()}`, {
          credentials: "include",
          signal,
        });

        let payload: DashboardPostsResponse | null = null;
        try {
          payload = (await response.json()) as DashboardPostsResponse;
        } catch {
          payload = null;
        }

        if (!response.ok) {
          throw new Error(payload?.message || "Unable to load posts.");
        }

        const resolvedPosts = payload?.data?.filter((post): post is DashboardPost => Boolean(post?._id));
        setPosts(resolvedPosts ?? []);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setPostsError(error instanceof Error ? error.message : "Unable to load posts.");
        setPosts([]);
      } finally {
        if (!signal.aborted) {
          setIsPostsLoading(false);
        }
      }
    },
    [apiBase, selectedAccountId],
  );

  useEffect(() => {
    if (connectedAccounts.length === 0) {
      setSelectedAccountId(undefined);
      return;
    }

    setSelectedAccountId((current) => {
      if (current && connectedAccounts.some((account) => account.id === current)) {
        return current;
      }
      return primaryAccountId ?? connectedAccounts[0]?.id;
    });
  }, [connectedAccounts, primaryAccountId]);

  useEffect(() => {
    if (!selectedAccountId) {
      setPosts([]);
      setPostsError(null);
      setIsPostsLoading(false);
      return;
    }

    const controller = new AbortController();
    void loadPosts(controller.signal);
    return () => controller.abort();
  }, [loadPosts, refreshKey, selectedAccountId]);

  useEffect(() => {
    if (!connectFeedback) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setConnectFeedback(null);
    }, 3200);

    return () => window.clearTimeout(timeoutId);
  }, [connectFeedback]);

  useEffect(() => {
    if (newPostModalState.isOpen && newPostModalState.mode === "create") {
      setGeneratedDraftId(null);
    }
  }, [newPostModalState.isOpen, newPostModalState.mode]);

  useEffect(() => {
    if (!isConnectMenuOpen) {
      return;
    }

    const handleOutsidePointer = (event: MouseEvent) => {
      const boundary = connectMenuBoundaryRef.current;
      if (!boundary) {
        return;
      }
      if (event.target instanceof Node && !boundary.contains(event.target)) {
        setIsConnectMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsConnectMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsidePointer);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsidePointer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isConnectMenuOpen]);

  useEffect(
    () => () => {
      if (popupWatcherRef.current !== null) {
        window.clearInterval(popupWatcherRef.current);
      }
    },
    [],
  );

  const openCenteredPopup = () => {
    const width = 560;
    const height = 700;
    const left = Math.max(0, Math.floor(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.floor(window.screenY + (window.outerHeight - height) / 2));
    const features = [
      `width=${width}`,
      `height=${height}`,
      `left=${left}`,
      `top=${top}`,
      "popup=yes",
      "resizable=yes",
      "scrollbars=yes",
    ].join(",");
    return window.open("", "marquill-linkedin-auth", features);
  };

  const handleConnectLinkedIn = async () => {
    if (isConnectingLinkedIn) {
      return;
    }

    setIsConnectMenuOpen(false);
    setConnectFeedback(null);

    const popup = openCenteredPopup();
    if (!popup) {
      setConnectFeedback("Popup was blocked. Please allow popups and try again.");
      return;
    }

    setIsConnectingLinkedIn(true);

    try {
      popup.document.title = "Connecting to LinkedIn";

      const response = await fetch(`${apiBase}/auth/linkedin`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      let payload: LinkedinAuthUrlResponse | null = null;
      try {
        payload = (await response.json()) as LinkedinAuthUrlResponse;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        throw new Error(payload?.message || "Unable to start account connection.");
      }

      const authUrl = payload?.data;
      if (!authUrl) {
        throw new Error("Unable to start account connection.");
      }

      new URL(authUrl);
      popup.location.href = authUrl;

      if (popupWatcherRef.current !== null) {
        window.clearInterval(popupWatcherRef.current);
      }

      popupWatcherRef.current = window.setInterval(() => {
        if (popup.closed) {
          if (popupWatcherRef.current !== null) {
            window.clearInterval(popupWatcherRef.current);
            popupWatcherRef.current = null;
          }
          window.location.reload();
        }
      }, 500);
    } catch (error) {
      if (!popup.closed) {
        popup.close();
      }
      setConnectFeedback(
        error instanceof Error
          ? error.message
          : "Unable to start account connection. Please try again.",
      );
    } finally {
      setIsConnectingLinkedIn(false);
    }
  };

  const finalizeAndRefresh = (message: string) => {
    setConnectFeedback(message);
    closeNewPostModal();
    setRefreshKey((value) => value + 1);
  };

  const uploadImageForPost = async (postId: string, file: File): Promise<void> => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${apiBase}/posts/${postId}/image`, {
      method: "PUT",
      credentials: "include",
      body: formData,
    });

    let parsedResponse: ImageUploadResponse | null = null;
    try {
      parsedResponse = (await response.json()) as ImageUploadResponse;
    } catch {
      parsedResponse = null;
    }

    if (!response.ok) {
      throw new Error(parsedResponse?.message || "Image upload failed.");
    }

    setConnectFeedback(parsedResponse?.message || "Image upload successful.");
  };

  const buildFileFromRemoteImage = async (
    imageUrl: string,
    fallbackName: string,
    fallbackMimeType?: string,
  ): Promise<File> => {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error("Unable to fetch selected Unsplash image.");
    }

    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const contentTypeHeader = response.headers.get("Content-Type")?.split(";")[0]?.trim();
    const mimeType = blob.type || contentTypeHeader || fallbackMimeType || "image/jpeg";

    const extensionByMimeType: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/avif": "avif",
    };
    const extension = extensionByMimeType[mimeType.toLowerCase()] || "jpg";
    const fileName = `${fallbackName}.${extension}`;

    return new File([buffer], fileName, { type: mimeType });
  };

  const updatePostContent = async (
    postId: string,
    content: string,
  ): Promise<UpdatePostResponse> => {
    const response = await fetch(`${apiBase}/posts/${postId}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    });

    let parsedResponse: UpdatePostResponse | null = null;
    try {
      parsedResponse = (await response.json()) as UpdatePostResponse;
    } catch {
      parsedResponse = null;
    }

    if (!response.ok) {
      throw new Error(parsedResponse?.message || "Unable to update post content.");
    }

    return parsedResponse ?? {};
  };

  const publishPost = async (postId: string): Promise<PublishPostResponse> => {
    const response = await fetch(`${apiBase}/posts/${postId}/publish`, {
      method: "POST",
      credentials: "include",
    });

    let parsedResponse: PublishPostResponse | null = null;
    try {
      parsedResponse = (await response.json()) as PublishPostResponse;
    } catch {
      parsedResponse = null;
    }

    if (!response.ok) {
      throw new Error(parsedResponse?.message || "Unable to publish post.");
    }

    return parsedResponse ?? {};
  };

  const schedulePost = async (
    postId: string,
    scheduledTime: string,
  ): Promise<SchedulePostResponse> => {
    const response = await fetch(`${apiBase}/posts/${postId}/schedule`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scheduledTime }),
    });

    let parsedResponse: SchedulePostResponse | null = null;
    try {
      parsedResponse = (await response.json()) as SchedulePostResponse;
    } catch {
      parsedResponse = null;
    }

    if (!response.ok) {
      throw new Error(parsedResponse?.message || "Unable to schedule post.");
    }

    return parsedResponse ?? {};
  };

  const handleModalAction = async (
    kind: "publish" | "schedule" | "draft",
    payload: NewPostSubmitPayload,
  ) => {
    const trimmedContent = payload.content.trim();
    if (!trimmedContent) {
      setConnectFeedback("Please add post content before continuing.");
      return;
    }

    if (payload.imageFile) {
      if (!payload.postId) {
        setConnectFeedback("Please save or generate this draft first before uploading a local image.");
        return;
      }
      try {
        await uploadImageForPost(payload.postId, payload.imageFile);
      } catch (error) {
        setConnectFeedback(error instanceof Error ? error.message : "Image upload failed.");
        return;
      }
    } else if (payload.imageSource === "unsplash" && payload.imageUrl) {
      if (!payload.postId) {
        setConnectFeedback("Please save or generate this draft first before uploading an Unsplash image.");
        return;
      }
      try {
        const remoteFile = await buildFileFromRemoteImage(
          payload.imageUrl,
          "unsplash-image",
          payload.imageMimeType,
        );
        await uploadImageForPost(payload.postId, remoteFile);
      } catch (error) {
        setConnectFeedback(
          error instanceof Error ? error.message : "Unsplash image upload failed.",
        );
        return;
      }
    }

    if (kind === "draft") {
      if (!payload.postId) {
        setConnectFeedback("Unable to save draft because post ID is missing.");
        return;
      }
      try {
        const response = await updatePostContent(payload.postId, payload.content);
        setConnectFeedback(response.message || "Post content updated successfully.");
        setRefreshKey((value) => value + 1);
      } catch (error) {
        setConnectFeedback(
          error instanceof Error ? error.message : "Unable to save draft changes.",
        );
      }
      return;
    }

    if (kind === "publish") {
      if (!payload.postId) {
        setConnectFeedback("Unable to publish because post ID is missing.");
        return;
      }
      try {
        const response = await publishPost(payload.postId);
        finalizeAndRefresh(response.message || "Post published successfully");
      } catch (error) {
        setConnectFeedback(error instanceof Error ? error.message : "Unable to publish post.");
      }
      return;
    }

    if (!payload.postId) {
      setConnectFeedback("Unable to schedule because post ID is missing.");
      return;
    }
    if (!payload.scheduledTime) {
      setConnectFeedback("Please choose a valid schedule date and time.");
      return;
    }

    try {
      const response = await schedulePost(payload.postId, payload.scheduledTime);
      finalizeAndRefresh(response.message || "Post scheduled successfully");
    } catch (error) {
      setConnectFeedback(error instanceof Error ? error.message : "Unable to schedule post.");
    }
  };

  const handleGenerateDraft = async (
    payload: NewDraftGeneratePayload,
  ): Promise<NewDraftGenerateResult> => {
    const input = payload.input.trim();
    if (!input) {
      throw new Error("Please add a prompt before generating a draft.");
    }

    if (!selectedAccountId) {
      const message = "Please select a connected account first.";
      setConnectFeedback(message);
      throw new Error(message);
    }

    const requestBody: CreateDraftRequest = {
      input,
      contentType: payload.contentType,
    };

    const response = await fetch(`${apiBase}/posts/${selectedAccountId}/draft`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    let parsedResponse: CreateDraftResponse | null = null;
    try {
      parsedResponse = (await response.json()) as CreateDraftResponse;
    } catch {
      parsedResponse = null;
    }

    if (!response.ok) {
      const message = parsedResponse?.message || "Unable to generate draft.";
      setConnectFeedback(message);
      throw new Error(message);
    }

    const createdDraftId = parsedResponse?.data;
    if (!createdDraftId) {
      const message = "Draft ID missing from response.";
      setConnectFeedback(message);
      throw new Error(message);
    }

    setGeneratedDraftId(createdDraftId);
    const message = parsedResponse?.message || "Draft created successfully";
    setConnectFeedback(message);
    setRefreshKey((value) => value + 1);

    return {
      draftId: createdDraftId,
      message,
    };
  };

  const handleGetDraftStatus = async (draftId: string): Promise<DraftStatusResponse> => {
    const response = await fetch(`${apiBase}/posts/${draftId}/status`, {
      credentials: "include",
    });

    let parsedResponse: DraftStatusResponse | null = null;
    try {
      parsedResponse = (await response.json()) as DraftStatusResponse;
    } catch {
      parsedResponse = null;
    }

    if (!response.ok) {
      throw new Error(parsedResponse?.message || "Unable to retrieve draft status.");
    }

    return parsedResponse ?? {};
  };

  const handleGetDraftById = useCallback(
    async (draftId: string): Promise<PostDetailResponse> => {
      const response = await fetch(`${apiBase}/posts/${draftId}`, {
        credentials: "include",
      });

      let parsedResponse: PostDetailResponse | null = null;
      try {
        parsedResponse = (await response.json()) as PostDetailResponse;
      } catch {
        parsedResponse = null;
      }

      if (!response.ok) {
        throw new Error(parsedResponse?.message || "Unable to retrieve generated draft.");
      }

      return parsedResponse ?? {};
    },
    [apiBase],
  );

  const handleGetLinkedinImageByUrn = useCallback(
    async (urn: string): Promise<LinkedinImageDetailsResponse> => {
      const response = await fetch(`${apiBase}/posts/linkedin/image/${encodeURIComponent(urn)}`, {
        credentials: "include",
      });

      let parsedResponse: LinkedinImageDetailsResponse | null = null;
      try {
        parsedResponse = (await response.json()) as LinkedinImageDetailsResponse;
      } catch {
        parsedResponse = null;
      }

      if (!response.ok) {
        throw new Error(parsedResponse?.message || "Unable to retrieve LinkedIn image details.");
      }

      return parsedResponse ?? {};
    },
    [apiBase],
  );

  const toggleResearch = useCallback((postId: string) => {
    setExpandedResearchPostIds((previous) => {
      const next = new Set(previous);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[var(--color-background)]">
      <div className="pointer-events-none absolute -left-28 top-10 h-80 w-80 rounded-full bg-[var(--color-accent)]/25 blur-[140px]" />
      <div className="pointer-events-none absolute right-6 top-24 h-64 w-64 rounded-full bg-[var(--color-primary)]/20 blur-[120px]" />

      <div className="relative flex min-h-screen w-full flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 md:hidden">
          <Card className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <UserAvatar initials={initials} avatarUrl={user.avatar} />
              <div>
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">{user.name}</p>
                <p className="text-xs text-[var(--color-text-secondary)]">{user.email}</p>
              </div>
            </div>
            <PillButton variant="secondary">Settings</PillButton>
          </Card>
        </header>

        <div
          ref={connectMenuBoundaryRef}
          className={`relative ${
            sidebarCollapsed ? "md:pl-[136px] lg:pl-[156px]" : "md:pl-[276px] lg:pl-[296px]"
          }`}
        >
          <Sidebar
            user={{ ...user, initials }}
            items={navItems}
            accounts={connectedAccounts}
            primaryAccountIndex={0}
            selectedAccountId={selectedAccountId}
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((value) => !value)}
            showChrome
            onSelectAccount={setSelectedAccountId}
            isConnectMenuOpen={isConnectMenuOpen}
            isConnectingLinkedIn={isConnectingLinkedIn}
            onToggleConnectMenu={() => setIsConnectMenuOpen((previousState) => !previousState)}
            onConnectLinkedIn={handleConnectLinkedIn}
          />

          <main className="flex flex-col gap-6">
            {connectFeedback ? (
              <div
                role="status"
                aria-live="polite"
                className="fixed right-4 top-4 z-40 rounded-2xl border border-[var(--color-border)] bg-white/95 px-4 py-3 text-sm font-medium text-[var(--color-text-primary)] shadow-[0_24px_60px_-45px_rgba(15,23,42,0.45)] backdrop-blur-md sm:right-6 sm:top-6 lg:right-8"
              >
                {connectFeedback}
              </div>
            ) : null}

            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[var(--color-text-secondary)]">
                  Manage your publishing workflow
                </p>
                <h1 className="mt-2 font-[var(--font-sora)] text-3xl font-semibold tracking-[-0.02em] text-[var(--color-text-primary)] sm:text-4xl">
                  Posts
                </h1>
              </div>
              <div className="flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-white/80 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    viewMode === "list"
                      ? "bg-[var(--color-primary)] text-white"
                      : "text-[var(--color-text-secondary)] hover:bg-white"
                  }`}
                >
                  List
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("calendar")}
                  className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    viewMode === "calendar"
                      ? "bg-[var(--color-primary)] text-white"
                      : "text-[var(--color-text-secondary)] hover:bg-white"
                  }`}
                >
                  Calendar
                </button>
              </div>
            </div>

            {!hasConnectedAccounts ? (
              <ConnectAccountCta
                isConnectMenuOpen={isConnectMenuOpen}
                isConnectingLinkedIn={isConnectingLinkedIn}
                menuId="connect-account-menu-posts"
                onToggleConnectMenu={() => setIsConnectMenuOpen((previousState) => !previousState)}
                onConnectLinkedIn={handleConnectLinkedIn}
              />
            ) : null}

            <Card className="p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {(Object.keys(postCounts) as PostTab[]).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition ${
                        activeTab === tab
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                          : "border-[var(--color-border)] bg-white/80 text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/40"
                      }`}
                    >
                      <span>{tab[0]}{tab.slice(1).toLowerCase()}</span>
                      <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs">{postCounts[tab]}</span>
                    </button>
                  ))}
                </div>
                <PillButton icon={<PenSquare className="h-4 w-4" />} onClick={openCreate}>
                  New Post
                </PillButton>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <PillButton variant="secondary" icon={<Tags className="h-4 w-4" />}>
                  Tags
                </PillButton>

                <label className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/85 px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)]">
                  <CalendarDays className="h-4 w-4" />
                  <span>{monthLabel}</span>
                </label>

                <select
                  value={selectedAccountId ?? ""}
                  onChange={(event) => setSelectedAccountId(event.target.value || undefined)}
                  className="rounded-full border border-[var(--color-border)] bg-white/85 px-3 py-2 text-sm font-medium text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
                  aria-label="Select connected account"
                >
                  {connectedAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.profile.name ?? account.profile.email ?? account.provider}
                    </option>
                  ))}
                </select>

                <label className="relative ml-auto min-w-[220px] flex-1 sm:max-w-[320px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search post content"
                    className="w-full rounded-full border border-[var(--color-border)] bg-white/85 py-2 pl-9 pr-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
                  />
                </label>
              </div>
            </Card>

            <section className={hasConnectedAccounts ? "" : "pointer-events-none opacity-60"}>
              {viewMode === "calendar" ? (
                <Card className="p-6">
                  <div className="flex items-center justify-between">
                    <h2 className="font-[var(--font-sora)] text-xl font-semibold text-[var(--color-text-primary)]">
                      Calendar Preview
                    </h2>
                    <PillButton variant="ghost" icon={<CalendarClock className="h-4 w-4" />}>
                      Read-only
                    </PillButton>
                  </div>

                  <div className="mt-5 grid grid-cols-7 gap-2 text-center text-[11px] font-semibold text-[var(--color-text-secondary)]">
                    {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
                      <div key={`${label}-${index}`}>{label}</div>
                    ))}
                  </div>

                  <div className="mt-3 grid grid-cols-7 gap-2">
                    {monthGrid.map((cell, index) => {
                      const isScheduledDay = cell.day !== null && scheduledDaysInCurrentMonth.has(cell.day);
                      const dayClass =
                        cell.day === null
                          ? "text-transparent"
                          : cell.isToday && isScheduledDay
                          ? "border border-[var(--color-secondary)] bg-[var(--color-secondary)] text-white shadow-[0_12px_30px_-20px_rgba(28,27,39,0.45)]"
                          : cell.isToday
                          ? "bg-[var(--color-secondary)] text-white shadow-[0_12px_30px_-20px_rgba(28,27,39,0.45)]"
                          : isScheduledDay
                          ? "border border-[#DCCFA4] bg-[#F6F1DE] text-[#7A5A00]"
                          : "border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-white/70";
                      return (
                        <div
                          key={`day-${index}`}
                          className={`flex h-9 items-center justify-center rounded-2xl text-xs font-semibold transition ${dayClass}`}
                        >
                          {cell.day ?? "0"}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-6 space-y-3">
                    {upcomingScheduledPosts.length === 0 ? (
                      <p className="text-sm text-[var(--color-text-secondary)]">No upcoming scheduled posts.</p>
                    ) : (
                      upcomingScheduledPosts.map((post) => (
                        <div
                          key={post._id}
                          className="rounded-2xl border border-[var(--color-border)] bg-white/85 px-4 py-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                              {getTitleFromContent(post.content)}
                            </p>
                            <StatusTag status="SCHEDULED" />
                          </div>
                          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                            {formatTimelineTime(post.scheduledAt)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </Card>
              ) : (
                <div className="flex flex-col gap-5">
                  {isPostsLoading ? (
                    <Card className="p-6">
                      <p className="text-sm text-[var(--color-text-secondary)]">Loading posts...</p>
                    </Card>
                  ) : null}

                  {postsError ? (
                    <Card className="p-6">
                      <p className="text-sm font-medium text-amber-700">{postsError}</p>
                    </Card>
                  ) : null}

                  {!isPostsLoading && !postsError && groupedPosts.length === 0 ? (
                    <Card className="p-6">
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        No posts found for this filter. Try another tab or create a new post.
                      </p>
                    </Card>
                  ) : null}

                  {!isPostsLoading && !postsError
                    ? groupedPosts.map((group) => (
                        <section key={group.dateKey} className="space-y-3">
                          <h3 className="px-1 font-[var(--font-sora)] text-xl font-semibold text-[var(--color-text-primary)]">
                            {group.label}
                          </h3>

                          <div className="space-y-3">
                            {group.items.map((post) => {
                              const status = normalizeStatus(post.status);
                              const isPublished = status === "PUBLISHED";
                              const isDraft = status === "DRAFT";
                              const scheduleLabel = isDraft ? "Schedule" : "Reschedule";
                              const canEdit = !isPublished;
                              const researchVideos =
                                post.type === "insightPostLinkedin" &&
                                Array.isArray(post.youtubeResearch)
                                  ? post.youtubeResearch.filter((video) =>
                                      Boolean(
                                        video &&
                                          (video.title ||
                                            video.videoId ||
                                            video.channelTitle),
                                      ),
                                    )
                                  : [];
                              const researchCount = researchVideos.length;
                              const isResearchExpanded = expandedResearchPostIds.has(post._id);
                              const researchPanelId = `research-panel-${post._id}`;
                              const onEdit = () => {
                                if (!canEdit) {
                                  return;
                                }
                                openEdit({
                                  postId: post._id,
                                  initialContent: post.content ?? "",
                                  initialImageUrl: undefined,
                                });
                              };

                              return (
                                <article
                                  key={post._id}
                                  {...(canEdit
                                    ? {
                                        role: "button" as const,
                                        tabIndex: 0,
                                        onClick: onEdit,
                                        onKeyDown: (event) => {
                                          if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            onEdit();
                                          }
                                        },
                                      }
                                    : {})}
                                  className="grid gap-3 rounded-2xl border border-[var(--color-border)] bg-white/90 p-4 transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-28px_rgba(15,23,42,0.4)] md:grid-cols-[132px_1fr]"
                                >
                                  <div className="flex flex-col gap-2 border-b border-[var(--color-border)] pb-3 md:border-b-0 md:border-r md:pb-0 md:pr-3">
                                    <p className="text-2xl font-semibold text-[var(--color-text-primary)]">
                                      {formatTimelineTime(post.scheduledAt ?? post.updatedAt ?? post.createdAt)}
                                    </p>
                                    <StatusTag status={status} />
                                  </div>

                                  <div className="space-y-4">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="flex items-center gap-3">
                                        <UserAvatar
                                          initials={initials}
                                          avatarUrl={selectedConnectedAccount?.profile?.picture ?? user.avatar}
                                          sizeClass="h-10 w-10"
                                          textClass="text-sm"
                                        />
                                        <div>
                                          <p className="text-base font-semibold text-[var(--color-text-primary)]">
                                            {selectedConnectedAccount?.profile?.name ?? user.name}
                                          </p>
                                          <p className="text-xs text-[var(--color-text-secondary)]">
                                            {selectedConnectedAccount?.profile?.email ?? "LinkedIn account"}
                                          </p>
                                        </div>
                                      </div>
                                    </div>

                                    <p className="text-lg leading-relaxed text-[var(--color-text-tertiary)]">
                                      {getTitleFromContent(post.content)}
                                    </p>

                                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-sm text-[var(--color-text-secondary)]">
                                          Updated {formatRelativeUpdateLabel(post.updatedAt ?? post.createdAt)}
                                        </p>
                                        {researchCount > 0 ? (
                                          <button
                                            type="button"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              toggleResearch(post._id);
                                            }}
                                            aria-expanded={isResearchExpanded}
                                            aria-controls={researchPanelId}
                                            className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/85 px-3 py-1.5 text-sm font-semibold text-[var(--color-text-secondary)] transition hover:border-[var(--color-primary)]/45 hover:text-[var(--color-primary)]"
                                          >
                                            <span className="grid h-5 w-5 place-items-center rounded-full bg-[#FF0033]">
                                              <svg
                                                aria-hidden="true"
                                                viewBox="0 0 24 24"
                                                className="h-3.5 w-3.5 fill-white"
                                              >
                                                <path d="M10 8l6 4-6 4V8z" />
                                              </svg>
                                            </span>
                                            <span>YouTube +{researchCount}</span>
                                          </button>
                                        ) : null}
                                      </div>

                                      <div className="flex items-center gap-2">
                                        {!isPublished ? (
                                          <PillButton
                                            variant="secondary"
                                            icon={<CalendarClock className="h-4 w-4" />}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              onEdit();
                                            }}
                                          >
                                            {scheduleLabel}
                                          </PillButton>
                                        ) : null}
                                        {canEdit ? (
                                          <button
                                            type="button"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              onEdit();
                                            }}
                                            className="grid h-9 w-9 place-items-center rounded-xl border border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                                            aria-label="Edit post"
                                          >
                                            <Edit3 className="h-4 w-4" />
                                          </button>
                                        ) : null}
                                        <button
                                          type="button"
                                          onClick={(event) => event.stopPropagation()}
                                          className="grid h-9 w-9 place-items-center rounded-xl border border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                                          aria-label="More actions"
                                        >
                                          <CircleEllipsis className="h-4 w-4" />
                                        </button>
                                      </div>
                                    </div>

                                    {researchCount > 0 && isResearchExpanded ? (
                                      <div
                                        id={researchPanelId}
                                        onClick={(event) => event.stopPropagation()}
                                        className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-overlay)] p-3 text-[var(--color-text-primary)] shadow-[0_24px_60px_-45px_rgba(15,23,42,0.32)]"
                                      >
                                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-secondary)]">
                                          Research videos
                                        </p>
                                        <div className="max-h-[240px] space-y-2 overflow-y-auto pr-1">
                                          {researchVideos.map((video, index) => {
                                            const videoHref = video.videoId
                                              ? `https://www.youtube.com/watch?v=${video.videoId}`
                                              : undefined;
                                            const rowContent = (
                                              <>
                                                {video.thumbnail ? (
                                                  <img
                                                    src={video.thumbnail}
                                                    alt={video.title ?? "YouTube video thumbnail"}
                                                    className="h-14 w-20 shrink-0 rounded-lg border border-[var(--color-border)] object-cover"
                                                  />
                                                ) : (
                                                  <div className="h-14 w-20 shrink-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)]" />
                                                )}
                                                <div className="min-w-0">
                                                  <p className="line-clamp-2 text-sm font-semibold text-[var(--color-text-primary)]">
                                                    {video.title ?? "Research video"}
                                                  </p>
                                                  <p className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">
                                                    {video.channelTitle ?? "YouTube"}
                                                  </p>
                                                </div>
                                              </>
                                            );

                                            if (videoHref) {
                                              return (
                                                <a
                                                  key={`${video.videoId ?? "video"}-${index}`}
                                                  href={videoHref}
                                                  target="_blank"
                                                  rel="noreferrer noopener"
                                                  onClick={(event) => event.stopPropagation()}
                                                  className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-white/85 p-2 transition hover:border-[var(--color-primary)]/45"
                                                >
                                                  {rowContent}
                                                </a>
                                              );
                                            }

                                            return (
                                              <div
                                                key={`video-fallback-${index}`}
                                                className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-white/85 p-2"
                                              >
                                                {rowContent}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        </section>
                      ))
                    : null}
                </div>
              )}
            </section>
          </main>
        </div>
      </div>

      <NewPostModal
        isOpen={newPostModalState.isOpen}
        mode={newPostModalState.mode}
        postId={newPostModalState.postId ?? generatedDraftId ?? undefined}
        initialContent={newPostModalState.initialContent}
        initialImageUrl={newPostModalState.initialImageUrl}
        account={{
          name: selectedConnectedAccount?.profile?.name,
          avatarUrl: selectedConnectedAccount?.profile?.picture,
          provider: selectedConnectedAccount?.provider,
        }}
        onClose={closeNewPostModal}
        onPublish={(payload) => handleModalAction("publish", payload)}
        onSchedule={(payload) => handleModalAction("schedule", payload)}
        onSaveDraft={(payload) => handleModalAction("draft", payload)}
        onGenerateDraft={handleGenerateDraft}
        onGetDraftStatus={handleGetDraftStatus}
        onGetDraftById={handleGetDraftById}
        onGetLinkedinImageByUrn={handleGetLinkedinImageByUrn}
      />
    </div>
  );
}
