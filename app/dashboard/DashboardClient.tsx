"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CalendarClock,
  LayoutDashboard,
  PenSquare,
  TrendingUp,
} from "lucide-react";
import Sidebar from "./Sidebar";
import NewPostModal, {
  type NewDraftGeneratePayload,
  type NewDraftGenerateResult,
  type NewPostSubmitPayload,
} from "./NewPostModal";
import {
  Card,
  ConnectAccountCta,
  ListItem,
  PillButton,
  UserAvatar,
} from "./components";
import { useNewPostModal } from "./useNewPostModal";
import type {
  ConnectedAccount,
  CreateDraftRequest,
  CreateDraftResponse,
  DashboardPost,
  DashboardPostsResponse,
  DraftStatusResponse,
  ImageUploadResponse,
  LinkedinImageDetailsResponse,
  LinkedinAuthUrlResponse,
  PublishPostResponse,
  SchedulePostResponse,
  PostMetricsResponse,
  PostDetailResponse,
  UpdatePostResponse,
  UserProfile,
} from "../lib/types";

const navItems = [
  {
    label: "Overview",
    active: true,
    href: "/dashboard",
    icon: <LayoutDashboard className="h-4 w-4" />,
  },
  { label: "Posts", active: false, href: "/posts", icon: <PenSquare className="h-4 w-4" /> },
  { label: "Calendar", active: false, disabled: true, icon: <CalendarClock className="h-4 w-4" /> },
  { label: "Analytics", active: false, disabled: true, icon: <TrendingUp className="h-4 w-4" /> },
];

const stats = {
  postsThisMonth: 12,
  postLimit: 30,
};

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

function toYearMonth(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function buildLastSixMonthKeys(baseDate: Date) {
  const keys: string[] = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    keys.push(toYearMonth(new Date(baseDate.getFullYear(), baseDate.getMonth() - offset, 1)));
  }
  return keys;
}

function monthLabelFromYearMonth(value: string) {
  const [yearPart, monthPart] = value.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return value;
  }
  return new Date(year, month - 1, 1).toLocaleString("en-US", { month: "short" });
}

function getDraftVisibleLimit(screenWidth: number) {
  if (screenWidth >= 1024) {
    return 4;
  }
  if (screenWidth >= 768) {
    return 3;
  }
  return 2;
}

function getTitleFromContent(content?: string) {
  if (!content) {
    return "Untitled draft";
  }
  const firstNonEmptyLine =
    content
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  const rawTitle = firstNonEmptyLine || content.trim();
  if (!rawTitle) {
    return "Untitled draft";
  }
  return rawTitle.length > 88 ? `${rawTitle.slice(0, 85)}...` : rawTitle;
}

function formatDraftUpdatedLabel(isoDate?: string) {
  if (!isoDate) {
    return "Recently";
  }

  const updatedAt = new Date(isoDate);
  if (Number.isNaN(updatedAt.getTime())) {
    return "Recently";
  }

  const now = new Date();
  const diffMs = now.getTime() - updatedAt.getTime();
  if (diffMs < 0) {
    return updatedAt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
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

  return updatedAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function parseUtcDate(value?: string) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatScheduledLocalDateTime(isoDate?: string) {
  const scheduled = parseUtcDate(isoDate);
  if (!scheduled) {
    return "Unknown schedule time";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(scheduled);
}

export default function DashboardPage({
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
  const [postMetrics, setPostMetrics] = useState<{
    total: number;
    monthly: Array<{ month: string; count: number }>;
  } | null>(null);
  const [isPostMetricsLoading, setIsPostMetricsLoading] = useState(false);
  const [postMetricsError, setPostMetricsError] = useState<string | null>(null);
  const [posts, setPosts] = useState<DashboardPost[]>([]);
  const [isPostsLoading, setIsPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [isViewingAllDrafts, setIsViewingAllDrafts] = useState(false);
  const [draftVisibleLimit, setDraftVisibleLimit] = useState(4);
  const [generatedDraftId, setGeneratedDraftId] = useState<string | null>(null);
  const { state: newPostModalState, openCreate, openEdit, close: closeNewPostModal } =
    useNewPostModal();
  const connectMenuBoundaryRef = useRef<HTMLDivElement | null>(null);
  const popupWatcherRef = useRef<number | null>(null);
  const now = useMemo(() => new Date(), []);
  const apiBase =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3500/api/v1";
  const monthLabel = now.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
  const monthGrid = useMemo(() => buildMonthGrid(now), [now]);
  const initials = getInitials(user.name, user.email);
  const hasConnectedAccounts =
    connectedAccounts.length > 0 && Boolean(selectedAccountId);
  const selectedConnectedAccount = useMemo(
    () =>
      connectedAccounts.find((account) => account.id === selectedAccountId) ??
      connectedAccounts[0],
    [connectedAccounts, selectedAccountId],
  );
  const usagePercent = Math.max(
    0,
    Math.min(100, Math.round((stats.postsThisMonth / stats.postLimit) * 100)),
  );
  const postsRemaining = Math.max(0, stats.postLimit - stats.postsThisMonth);
  const billingState =
    usagePercent >= 90 ? "limit" : usagePercent >= 70 ? "near-limit" : "on-track";
  const billingStateMeta = {
    "on-track": {
      note: "Great momentum this cycle.",
      meter: "from-[var(--color-primary)] to-[var(--color-accent)]",
    },
    "near-limit": {
      note: "Plan your next posts carefully.",
      meter: "from-amber-400 to-orange-400",
    },
    limit: {
      note: "Upgrade or wait for next cycle.",
      meter: "from-rose-400 to-rose-600",
    },
  } as const;
  const billingMeta = billingStateMeta[billingState];
  const lastSixMonthKeys = useMemo(() => buildLastSixMonthKeys(now), [now]);
  const sixMonthSeries = useMemo(() => {
    const countsByMonth = new Map<string, number>();
    for (const item of postMetrics?.monthly ?? []) {
      countsByMonth.set(item.month, item.count);
    }
    return lastSixMonthKeys.map((monthKey) => ({
      key: monthKey,
      month: monthLabelFromYearMonth(monthKey),
      count: countsByMonth.get(monthKey) ?? 0,
    }));
  }, [lastSixMonthKeys, postMetrics]);
  const currentSeriesPoint = sixMonthSeries[sixMonthSeries.length - 1];
  const chartAriaLabel = `Posts over last 6 months: ${sixMonthSeries
    .map((point) => `${point.month} ${point.count}`)
    .join(", ")}`;
  const chartWidth = 320;
  const chartHeight = 150;
  const chartPadding = { left: 34, right: 12, top: 12, bottom: 24 };
  const plotWidth = chartWidth - chartPadding.left - chartPadding.right;
  const plotHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const maxCount = Math.max(...sixMonthSeries.map((point) => point.count), 0);
  const yMax = Math.max(5, Math.ceil(maxCount / 5) * 5);
  const yTicks = Array.from({ length: yMax / 5 + 1 }, (_, index) => index * 5);
  const chartPoints = sixMonthSeries.map((point, index) => {
    const x = chartPadding.left + (index * plotWidth) / (sixMonthSeries.length - 1);
    const y = chartPadding.top + ((yMax - point.count) / yMax) * plotHeight;
    return { ...point, x, y };
  });
  const polylinePoints = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPath =
    chartPoints.length > 0
      ? `M ${chartPoints[0].x} ${chartPadding.top + plotHeight} L ${chartPoints
          .map((point) => `${point.x} ${point.y}`)
          .join(" L ")} L ${chartPoints[chartPoints.length - 1].x} ${chartPadding.top + plotHeight} Z`
      : "";
  const lastPoint = chartPoints[chartPoints.length - 1];
  const tooltipText = lastPoint ? `${lastPoint.month}:${lastPoint.count}` : "";
  const tooltipPaddingX = 10;
  const tooltipHeight = 20;
  const estimatedCharWidth = 6;
  const tooltipWidth = Math.max(
    52,
    tooltipText.length * estimatedCharWidth + tooltipPaddingX * 2,
  );
  const tooltipX = lastPoint
    ? Math.min(
        chartWidth - chartPadding.right - tooltipWidth,
        Math.max(chartPadding.left, lastPoint.x - tooltipWidth / 2),
      )
    : chartPadding.left;
  const tooltipY = lastPoint ? Math.max(chartPadding.top, lastPoint.y - 28) : chartPadding.top;
  const tooltipTextX = tooltipX + tooltipWidth / 2;
  const draftPosts = useMemo(
    () =>
      posts.filter(
        (post) => Boolean(post?._id) && String(post.status ?? "").toUpperCase() === "DRAFT",
      ),
    [posts],
  );
  const scheduledPosts = useMemo(
    () =>
      posts
        .filter((post) => String(post.status ?? "").toUpperCase() === "SCHEDULED")
        .map((post) => {
          const scheduledDate = parseUtcDate(post.scheduledAt);
          return scheduledDate ? { ...post, scheduledDate } : null;
        })
        .filter((post): post is DashboardPost & { scheduledDate: Date } => post !== null),
    [posts],
  );
  const nearestScheduledPosts = useMemo(() => {
    const nowTs = Date.now();
    return [...scheduledPosts]
      .filter((post) => post.scheduledDate.getTime() >= nowTs)
      .sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime())
      .slice(0, 3);
  }, [scheduledPosts]);
  const scheduledDaysInCurrentMonth = useMemo(() => {
    const days = new Set<number>();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    for (const post of scheduledPosts) {
      const date = post.scheduledDate;
      if (date.getFullYear() === currentYear && date.getMonth() === currentMonth) {
        days.add(date.getDate());
      }
    }
    return days;
  }, [now, scheduledPosts]);

  const displayedDraftPosts = useMemo(() => {
    if (isViewingAllDrafts) {
      return draftPosts;
    }
    return draftPosts.slice(0, draftVisibleLimit);
  }, [draftPosts, draftVisibleLimit, isViewingAllDrafts]);
  const canToggleDrafts = draftPosts.length > draftVisibleLimit;

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
    const updateLimit = () => {
      setDraftVisibleLimit(getDraftVisibleLimit(window.innerWidth));
    };

    updateLimit();
    window.addEventListener("resize", updateLimit);
    return () => window.removeEventListener("resize", updateLimit);
  }, []);

  useEffect(() => {
    if (!selectedAccountId) {
      setPostMetrics(null);
      setPostMetricsError(null);
      setIsPostMetricsLoading(false);
      return;
    }

    const controller = new AbortController();

    const loadPostMetrics = async () => {
      setIsPostMetricsLoading(true);
      setPostMetricsError(null);

      try {
        const response = await fetch(`${apiBase}/posts/metrics/${selectedAccountId}`, {
          credentials: "include",
          signal: controller.signal,
        });

        let payload: PostMetricsResponse | null = null;
        try {
          payload = (await response.json()) as PostMetricsResponse;
        } catch {
          payload = null;
        }

        if (!response.ok) {
          throw new Error(payload?.message || "Unable to load post metrics.");
        }

        const monthly =
          payload?.data?.monthly
            ?.filter(
              (item): item is { month: string; count: number } =>
                Boolean(item) && typeof item.month === "string" && typeof item.count === "number",
            )
            .map((item) => ({
              month: item.month,
              count: Math.max(0, Math.round(item.count)),
            })) ?? [];
        const total =
          typeof payload?.data?.total === "number"
            ? payload.data.total
            : monthly.reduce((sum, item) => sum + item.count, 0);

        setPostMetrics({
          total,
          monthly,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setPostMetricsError(
          error instanceof Error ? error.message : "Unable to load post metrics.",
        );
        setPostMetrics(null);
      } finally {
        if (!controller.signal.aborted) {
          setIsPostMetricsLoading(false);
        }
      }
    };

    void loadPostMetrics();

    return () => {
      controller.abort();
    };
  }, [apiBase, selectedAccountId]);

  useEffect(() => {
    if (!selectedAccountId) {
      setPosts([]);
      setPostsError(null);
      setIsPostsLoading(false);
      setIsViewingAllDrafts(false);
      return;
    }

    const controller = new AbortController();

    const loadPosts = async () => {
      setIsPostsLoading(true);
      setPostsError(null);
      setIsViewingAllDrafts(false);

      try {
        const month = toYearMonth(new Date());
        const query = new URLSearchParams({
          accountConnected: selectedAccountId,
          month,
        });
        const response = await fetch(`${apiBase}/posts?${query.toString()}`, {
          credentials: "include",
          signal: controller.signal,
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

        const resolvedPosts = payload?.data?.filter((post): post is DashboardPost =>
          Boolean(post?._id),
        );
        setPosts(resolvedPosts ?? []);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setPostsError(error instanceof Error ? error.message : "Unable to load posts.");
        setPosts([]);
      } finally {
        if (!controller.signal.aborted) {
          setIsPostsLoading(false);
        }
      }
    };

    void loadPosts();

    return () => {
      controller.abort();
    };
  }, [apiBase, selectedAccountId]);

  useEffect(() => {
    if (!connectFeedback) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setConnectFeedback(null);
    }, 2800);
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
    const top = Math.max(
      0,
      Math.floor(window.screenY + (window.outerHeight - height) / 2),
    );
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
        setConnectFeedback(
          error instanceof Error ? error.message : "Image upload failed.",
        );
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
        finalizeAndReload(response.message || "Post published successfully");
      } catch (error) {
        setConnectFeedback(
          error instanceof Error ? error.message : "Unable to publish post.",
        );
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
      finalizeAndReload(response.message || "Post scheduled successfully");
    } catch (error) {
      setConnectFeedback(
        error instanceof Error ? error.message : "Unable to schedule post.",
      );
    }
  };

  const finalizeAndReload = (message: string) => {
    setConnectFeedback(message);
    closeNewPostModal();
    window.location.reload();
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

  const handleGetDraftById = useCallback(async (draftId: string): Promise<PostDetailResponse> => {
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
  }, [apiBase]);

  const handleGetLinkedinImageByUrn = useCallback(async (
    urn: string,
  ): Promise<LinkedinImageDetailsResponse> => {
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
      throw new Error(
        parsedResponse?.message || "Unable to retrieve LinkedIn image details.",
      );
    }

    return parsedResponse ?? {};
  }, [apiBase]);

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
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {user.name}
                </p>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {user.email}
                </p>
              </div>
            </div>
            <PillButton variant="secondary">Settings</PillButton>
          </Card>
          <nav className="flex gap-3 overflow-x-auto pb-1 text-sm">
            {navItems.map((item) => (
              <PillButton
                key={item.label}
                variant={item.active ? "primary" : "secondary"}
              >
                {item.label}
              </PillButton>
            ))}
          </nav>
        </header>

        <div
          ref={connectMenuBoundaryRef}
          className={`relative ${
            sidebarCollapsed
              ? "md:pl-[136px] lg:pl-[156px]"
              : "md:pl-[276px] lg:pl-[296px]"
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
            onToggleConnectMenu={() =>
              setIsConnectMenuOpen((previousState) => !previousState)
            }
            onConnectLinkedIn={handleConnectLinkedIn}
          />

          <main className="flex flex-col gap-8">
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
                  Good afternoon, {user.name.split(" ")[0]}
                </p>
                <h1 className="mt-2 font-[var(--font-sora)] text-3xl font-semibold tracking-[-0.02em] text-[var(--color-text-primary)] sm:text-4xl">
                  Dashboard
                </h1>
              </div>
              <PillButton variant="secondary" icon={<CalendarClock className="h-4 w-4" />}>
                {monthLabel}
              </PillButton>
            </div>

            {!hasConnectedAccounts ? (
              <ConnectAccountCta
                isConnectMenuOpen={isConnectMenuOpen}
                isConnectingLinkedIn={isConnectingLinkedIn}
                menuId="connect-account-menu-cta"
                onToggleConnectMenu={() =>
                  setIsConnectMenuOpen((previousState) => !previousState)
                }
                onConnectLinkedIn={handleConnectLinkedIn}
              />
            ) : null}

            <div
              className={`flex flex-col gap-8 ${
                hasConnectedAccounts ? "" : "pointer-events-none opacity-60"
              }`}
              aria-disabled={!hasConnectedAccounts}
            >
              <section className="grid gap-4 lg:grid-cols-2">
                <Card className="group relative overflow-hidden p-6 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_36px_80px_-58px_rgba(15,23,42,0.45)]">
                  <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[var(--color-accent)]/20 blur-3xl" />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[var(--color-primary)]/8 via-white/70 to-[var(--color-accent)]/10" />
                  <div className="relative flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                        Posts this billing cycle
                      </p>
                      <div className="mt-4 flex items-end gap-3">
                        <span className="text-4xl font-semibold leading-none text-[var(--color-text-primary)]">
                          {stats.postsThisMonth}
                        </span>
                        <span className="pb-1 text-lg font-semibold text-[var(--color-text-secondary)]">
                          / {stats.postLimit}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="relative mt-5">
                    <div className="h-2.5 w-full rounded-full bg-[var(--color-border)]">
                      <div
                        className={`h-2.5 rounded-full bg-gradient-to-r ${billingMeta.meter} transition-all duration-500 ease-out`}
                        style={{ width: `${usagePercent}%` }}
                      />
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs font-medium text-[var(--color-text-secondary)]">
                      <span>Used: {stats.postsThisMonth}</span>
                      <span>Remaining: {postsRemaining}</span>
                    </div>
                  </div>
                  <p className="relative mt-4 text-sm text-[var(--color-text-secondary)]">
                    {postsRemaining} posts left in this cycle. {billingMeta.note}
                  </p>
                </Card>

                <Card className="group relative overflow-hidden p-6 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_36px_80px_-58px_rgba(15,23,42,0.45)]">
                  <div className="pointer-events-none absolute -left-10 -top-12 h-40 w-40 rounded-full bg-white/60 blur-2xl" />
                  <div className="pointer-events-none absolute -right-20 top-2 h-52 w-52 rounded-full bg-[var(--color-primary)]/20 blur-3xl" />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[var(--color-primary)]/12 via-white/70 to-[var(--color-accent)]/16" />
                  <div className="relative">
                    <div className="mt-1 flex items-end gap-3">
                      <span className="text-4xl font-semibold leading-none tracking-[-0.02em] text-[var(--color-text-primary)]">
                        {currentSeriesPoint?.count ?? 0}
                      </span>
                      <span className="pb-1 text-sm font-semibold text-[var(--color-text-secondary)]">
                        posts this month
                      </span>
                    </div>

                    <div className="mt-5 rounded-2xl border border-[var(--color-border)]/70 bg-white/60 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                      {!selectedAccountId ? (
                        <p className="mb-3 text-xs font-medium text-[var(--color-text-secondary)]">
                          Connect an account to load post metrics.
                        </p>
                      ) : null}
                      {selectedAccountId && isPostMetricsLoading ? (
                        <p className="mb-3 text-xs font-medium text-[var(--color-text-secondary)]">
                          Loading metrics...
                        </p>
                      ) : null}
                      {postMetricsError ? (
                        <p className="mb-3 text-xs font-medium text-amber-700">
                          {postMetricsError}
                        </p>
                      ) : null}
                      <svg
                        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                        className="h-auto w-full"
                        role="img"
                        aria-label={chartAriaLabel}
                      >
                        <defs>
                          <linearGradient id="posts-6m-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#5B5CF6" stopOpacity="0.3" />
                            <stop offset="100%" stopColor="#5B5CF6" stopOpacity="0.02" />
                          </linearGradient>
                          <linearGradient id="posts-6m-stroke" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#5B5CF6" />
                            <stop offset="100%" stopColor="#2FA5F7" />
                          </linearGradient>
                        </defs>
                        {yTicks.map((tick) => {
                          const y = chartPadding.top + ((yMax - tick) / yMax) * plotHeight;
                          return (
                            <g key={tick}>
                              <line
                                x1={chartPadding.left}
                                y1={y}
                                x2={chartWidth - chartPadding.right}
                                y2={y}
                                stroke="#E3E8F4"
                                strokeWidth="1"
                              />
                              <text
                                x={chartPadding.left - 6}
                                y={y + 3}
                                textAnchor="end"
                                fontSize="10"
                                fill="#8B97B0"
                                fontWeight="600"
                              >
                                {tick}
                              </text>
                            </g>
                          );
                        })}
                        <path d={areaPath} fill="url(#posts-6m-fill)" />
                        <polyline
                          points={polylinePoints}
                          fill="none"
                          stroke="url(#posts-6m-stroke)"
                          strokeWidth="1.75"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        {chartPoints.map((point, index) => (
                          <circle
                            key={`${point.month}-${index}`}
                            cx={point.x}
                            cy={point.y}
                            r={index === chartPoints.length - 1 ? 4 : 2.5}
                            fill={index === chartPoints.length - 1 ? "#5B5CF6" : "#8B97B0"}
                          />
                        ))}
                        {lastPoint ? (
                          <>
                            <rect
                              x={tooltipX}
                              y={tooltipY}
                              width={tooltipWidth}
                              height={tooltipHeight}
                              rx="10"
                              fill="#111827"
                              opacity="0.9"
                            />
                            <text
                              x={tooltipTextX}
                              y={tooltipY + 14}
                              textAnchor="middle"
                              fontSize="10"
                              fill="#FFFFFF"
                              fontWeight="600"
                            >
                              {tooltipText}
                            </text>
                          </>
                        ) : null}
                      </svg>
                      <div className="mt-2 grid grid-cols-6 text-center text-[11px] font-semibold text-[var(--color-text-secondary)]">
                        {sixMonthSeries.map((point) => (
                          <span key={point.month}>{point.month}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </Card>
              </section>

              <Card className="p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="font-[var(--font-sora)] text-xl font-semibold text-[var(--color-text-primary)]">
                      Quick actions
                    </h2>
                    <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                      Start a new idea or schedule content in seconds.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <PillButton
                      icon={<PenSquare className="h-4 w-4" />}
                      onClick={openCreate}
                    >
                      New post
                    </PillButton>
                    <PillButton
                      variant="secondary"
                      icon={<CalendarClock className="h-4 w-4" />}
                    >
                      Schedule
                    </PillButton>
                  </div>
                </div>
              </Card>

              <section className="grid gap-6 lg:grid-cols-2">
                <Card className="p-6">
                  <div className="flex items-center justify-between">
                    <h2 className="font-[var(--font-sora)] text-xl font-semibold text-[var(--color-text-primary)]">
                      Drafts
                    </h2>
                    {canToggleDrafts ? (
                      <PillButton
                        variant="ghost"
                        onClick={() => setIsViewingAllDrafts((value) => !value)}
                      >
                        {isViewingAllDrafts ? "Show less" : "View all"}
                      </PillButton>
                    ) : null}
                  </div>
                  <div className="mt-6 flex flex-col gap-4">
                    {isPostsLoading ? (
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        Loading drafts...
                      </p>
                    ) : null}
                    {postsError ? (
                      <p className="text-sm text-amber-700">{postsError}</p>
                    ) : null}
                    {!isPostsLoading && !postsError && displayedDraftPosts.length === 0 ? (
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        No drafts for this month.
                      </p>
                    ) : null}
                    {!isPostsLoading && !postsError
                      ? displayedDraftPosts.map((post) => (
                          <ListItem
                            key={post._id}
                            title={getTitleFromContent(post.content)}
                            subtitle={`Updated ${formatDraftUpdatedLabel(
                              post.updatedAt ?? post.createdAt,
                            )}`}
                            status="DRAFT"
                            onClick={() => {
                              if (!post._id) {
                                return;
                              }
                              openEdit({
                                postId: post._id,
                                initialContent: post.content ?? "",
                                initialImageUrl: undefined,
                              });
                            }}
                            ariaLabel={`Edit draft: ${getTitleFromContent(post.content)}`}
                          />
                        ))
                      : null}
                  </div>
                </Card>

                <Card className="p-6">
                  <div className="flex items-center justify-between">
                    <h2 className="font-[var(--font-sora)] text-xl font-semibold text-[var(--color-text-primary)]">
                      Scheduled
                    </h2>
                    <PillButton variant="ghost" icon={<Activity className="h-4 w-4" />}>
                      Timeline
                    </PillButton>
                  </div>

                  <div className="mt-5 grid grid-cols-7 gap-2 text-center text-[11px] font-semibold text-[var(--color-text-secondary)]">
                    {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
                      <div key={`${label}-${index}`}>{label}</div>
                    ))}
                  </div>
                  <div className="mt-3 grid grid-cols-7 gap-2">
                    {monthGrid.map((cell, index) => (
                      (() => {
                        const isScheduledDay =
                          cell.day !== null && scheduledDaysInCurrentMonth.has(cell.day);
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
                      })()
                    ))}
                  </div>

                  <div className="mt-6 space-y-3">
                    {isPostsLoading ? (
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        Loading scheduled posts...
                      </p>
                    ) : null}
                    {postsError ? (
                      <p className="text-sm text-amber-700">{postsError}</p>
                    ) : null}
                    {!isPostsLoading && !postsError && nearestScheduledPosts.length === 0 ? (
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        No upcoming scheduled posts this month.
                      </p>
                    ) : null}
                    {!isPostsLoading && !postsError
                      ? nearestScheduledPosts.map((post) => (
                          <ListItem
                            key={post._id}
                            title={getTitleFromContent(post.content)}
                            subtitle={formatScheduledLocalDateTime(post.scheduledAt)}
                            status="SCHEDULED"
                          />
                        ))
                      : null}
                  </div>
                </Card>
              </section>
            </div>
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
