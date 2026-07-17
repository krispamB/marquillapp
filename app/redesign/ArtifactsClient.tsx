"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  Layers3,
} from "lucide-react";
import RedesignShell from "./Shell";
import { API_BASE, readApi } from "./api";
import { formatRelativeDate } from "./types";
import type {
  ConnectedAccount,
  SubscriptionTier,
  UserProfile,
} from "../lib/types";
import type {
  ArtifactDetailData,
  ArtifactDetailResponse,
  ArtifactSlide,
  ArtifactStatus,
  ArtifactSummary,
  ArtifactType,
  ArtifactsListResponse,
} from "./artifactTypes";

type ArtifactFilter = "ALL" | ArtifactType;
type DetailState =
  | { status: "loading" }
  | { status: "loaded"; data: ArtifactDetailData }
  | { status: "error" };

const filterLabels: Array<{ key: ArtifactFilter; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "POST", label: "Posts" },
  { key: "DOCUMENT", label: "Carousels" },
  { key: "POLL", label: "Polls" },
];

const typeLabels: Record<ArtifactType, string> = {
  POST: "Post",
  POLL: "Poll",
  DOCUMENT: "Carousel",
};

function artifactIcon(type: ArtifactType) {
  if (type === "POLL") return <BarChart3 size={13} />;
  if (type === "DOCUMENT") return <Layers3 size={13} />;
  return <FileText size={13} />;
}

function statusLabel(status: ArtifactStatus) {
  if (status === "GENERATING") return "Generating";
  if (status === "FAILED") return "Needs attention";
  return "Ready";
}

function slideCopy(slide: ArtifactSlide) {
  switch (slide.type) {
    case "cover":
      return { heading: slide.fields.title, detail: slide.fields.eyebrow ?? slide.fields.subtitle };
    case "content":
      return { heading: slide.fields.heading, detail: slide.fields.body };
    case "list":
      return { heading: slide.fields.heading, detail: slide.fields.items.slice(0, 2).join(" · ") };
    case "quote":
      return { heading: slide.fields.quote, detail: slide.fields.attribution };
    case "cta":
      return { heading: slide.fields.headline, detail: slide.fields.action };
  }
}

function SlidePreview({ slide, index }: { slide: ArtifactSlide; index: number }) {
  const copy = slideCopy(slide);
  return (
    <div className={`mq-artifact-slide mq-artifact-slide-${slide.type}`}>
      <span>{String(index + 1).padStart(2, "0")}</span>
      <strong>{copy.heading}</strong>
      {copy.detail ? <small>{copy.detail}</small> : null}
    </div>
  );
}

function DetailSkeleton({ type }: { type: "POLL" | "DOCUMENT" }) {
  return (
    <div className={`mq-artifact-detail-skeleton mq-artifact-detail-skeleton-${type.toLowerCase()}`} aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function ArtifactCard({
  artifact,
  detailState,
  onVisible,
}: {
  artifact: ArtifactSummary;
  detailState?: DetailState;
  onVisible: (artifactId: string) => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const shouldEnrich = artifact.status === "READY" && artifact.type !== "POST";

  useEffect(() => {
    if (!shouldEnrich || detailState) return;
    const node = cardRef.current;
    if (!node || !("IntersectionObserver" in window)) {
      onVisible(artifact.id);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onVisible(artifact.id);
          observer.disconnect();
        }
      },
      { rootMargin: "220px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [artifact.id, detailState, onVisible, shouldEnrich]);

  const detail = detailState?.status === "loaded" ? detailState.data : undefined;
  const summaryCommentary = artifact.preview?.commentary?.trim();
  const commentary = detail?.content.commentary?.trim() || summaryCommentary;
  const poll = detail?.content.poll;
  const document = detail?.content.document;
  const pollQuestion = poll?.question?.trim() || artifact.title?.trim() || "Untitled poll";
  const documentSlides = document?.slides ?? (artifact.preview?.firstSlide ? [artifact.preview.firstSlide] : []);
  const visibleSlides = documentSlides.slice(0, 3);
  const documentPageCount = document?.pageCount ?? documentSlides.length;
  const remainingSlides = Math.max(0, documentPageCount - visibleSlides.length);

  return (
    <article
      ref={cardRef}
      className={`mq-card mq-artifact-card mq-artifact-card-${artifact.type.toLowerCase()}`}
      aria-busy={detailState?.status === "loading" || undefined}
    >
      <div className="mq-artifact-card-header">
        <span className={`mq-artifact-type mq-artifact-type-${artifact.type.toLowerCase()}`}>
          {artifactIcon(artifact.type)} {typeLabels[artifact.type]}
        </span>
        <span className={`mq-artifact-state mq-artifact-state-${artifact.status.toLowerCase()}`}>
          <i /> {statusLabel(artifact.status)}
        </span>
      </div>

      <div className="mq-artifact-card-body">
        {artifact.type === "POST" ? (
          <>
            {artifact.title ? <h2>{artifact.title}</h2> : null}
            <p className="mq-artifact-commentary">{summaryCommentary || "No post preview is available yet."}</p>
          </>
        ) : null}

        {artifact.type === "POLL" ? (
          <>
            <h2>{pollQuestion}</h2>
            {commentary && commentary !== pollQuestion ? <p className="mq-artifact-intro">{commentary}</p> : null}
            {detailState?.status === "loading" ? <DetailSkeleton type="POLL" /> : null}
            {poll?.options?.length ? (
              <div className="mq-artifact-poll-options">
                {poll.options.map((option) => <span key={option}>{option}</span>)}
              </div>
            ) : null}
            {poll ? <span className="mq-artifact-duration">Open for {poll.durationDays} day{poll.durationDays === 1 ? "" : "s"}</span> : null}
          </>
        ) : null}

        {artifact.type === "DOCUMENT" ? (
          <>
            {detailState?.status === "loading" ? <DetailSkeleton type="DOCUMENT" /> : null}
            {visibleSlides.length ? (
              <div className="mq-artifact-slides">
                {visibleSlides.map((slide, index) => <SlidePreview key={`${slide.type}-${index}`} slide={slide} index={index} />)}
                {remainingSlides ? <span className="mq-artifact-slide-more">+{remainingSlides}</span> : null}
              </div>
            ) : null}
            <h2>{artifact.title?.trim() || slideCopy(documentSlides[0] ?? { type: "cover", fields: { title: "Untitled carousel" } }).heading}</h2>
            <p className="mq-artifact-commentary">{commentary || "No carousel commentary is available yet."}</p>
          </>
        ) : null}
      </div>

      <footer className="mq-artifact-card-footer">
        <span>{artifact.status === "READY" ? "Current version" : statusLabel(artifact.status)}</span>
        <time dateTime={artifact.updatedAt}>{formatRelativeDate(artifact.updatedAt)}</time>
      </footer>
    </article>
  );
}

function ArtifactGridSkeleton() {
  return (
    <div className="mq-artifact-grid" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="mq-card mq-artifact-card mq-artifact-card-skeleton" key={index}>
          <span /><span /><span /><span />
        </div>
      ))}
    </div>
  );
}

export default function ArtifactsRedesignClient({
  user,
  connectedAccounts,
  primaryAccountId,
  subscription,
}: {
  user: UserProfile;
  connectedAccounts: ConnectedAccount[];
  primaryAccountId?: string;
  subscription?: SubscriptionTier | null;
}) {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [filter, setFilter] = useState<ArtifactFilter>("ALL");
  const [month, setMonth] = useState("");
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const detailCache = useRef(new Map<string, ArtifactDetailData>());
  const detailControllers = useRef(new Map<string, AbortController>());

  const abortDetailRequests = useCallback((resetLoading = true) => {
    detailControllers.current.forEach((controller) => controller.abort());
    detailControllers.current.clear();
    if (resetLoading) {
      setDetails((current) => Object.fromEntries(
        Object.entries(current).filter(([, state]) => state.status !== "loading"),
      ));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const params = new URLSearchParams({ page: String(page) });
    if (filter !== "ALL") params.set("type", filter);
    if (month) params.set("month", month);

    readApi<ArtifactsListResponse>(`${API_BASE}/artifacts?${params.toString()}`, { signal: controller.signal })
      .then((response) => {
        setArtifacts(Array.isArray(response?.data) ? response.data : []);
        setAvailableMonths(Array.isArray(response?.filters?.availableMonths) ? response.filters.availableMonths : []);
        setPages(Math.max(1, response?.pages ?? 1));
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setArtifacts([]);
          setPages(1);
          setError(reason instanceof Error ? reason.message : "Unable to load artifacts.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [abortDetailRequests, filter, month, page]);

  useEffect(() => () => abortDetailRequests(false), [abortDetailRequests]);

  const loadDetail = useCallback((artifactId: string) => {
    const cached = detailCache.current.get(artifactId);
    if (cached) {
      setDetails((current) => ({ ...current, [artifactId]: { status: "loaded", data: cached } }));
      return;
    }
    if (detailControllers.current.has(artifactId)) return;

    const controller = new AbortController();
    detailControllers.current.set(artifactId, controller);
    setDetails((current) => ({ ...current, [artifactId]: { status: "loading" } }));

    readApi<ArtifactDetailResponse>(`${API_BASE}/artifacts/${encodeURIComponent(artifactId)}`, { signal: controller.signal })
      .then((response) => {
        if (!response?.data) throw new Error("Artifact details were unavailable.");
        detailCache.current.set(artifactId, response.data);
        setDetails((current) => ({ ...current, [artifactId]: { status: "loaded", data: response.data! } }));
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setDetails((current) => ({ ...current, [artifactId]: { status: "error" } }));
        }
      })
      .finally(() => {
        if (detailControllers.current.get(artifactId) === controller) detailControllers.current.delete(artifactId);
      });
  }, []);

  function changeFilter(nextFilter: ArtifactFilter) {
    abortDetailRequests();
    setIsLoading(true);
    setError(null);
    setFilter(nextFilter);
    setPage(1);
  }

  function changeMonth(nextMonth: string) {
    abortDetailRequests();
    setIsLoading(true);
    setError(null);
    setMonth(nextMonth);
    setPage(1);
  }

  function changePage(nextPage: number) {
    abortDetailRequests();
    setIsLoading(true);
    setError(null);
    setPage(nextPage);
  }

  return (
    <RedesignShell
      user={user}
      accounts={connectedAccounts}
      selectedAccountId={primaryAccountId}
      subscription={subscription}
      active="artifacts"
      title="Artifacts"
      showAccountSelector={false}
    >
      <div className="mq-toolbar mq-artifact-toolbar">
        <div className="mq-segmented" role="tablist" aria-label="Artifact type">
          {filterLabels.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={filter === item.key}
              className={filter === item.key ? "is-active" : ""}
              onClick={() => changeFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="mq-filter-select mq-artifact-month-filter">
          <CalendarDays size={14} />
          <span className="sr-only">Filter artifacts by month</span>
          <select value={month} onChange={(event) => changeMonth(event.target.value)}>
            <option value="">All months</option>
            {availableMonths.map((value) => (
              <option value={value} key={value}>
                {new Date(`${value}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <div className="mq-alert mq-alert-error" role="alert">{error}</div> : null}
      {isLoading ? <ArtifactGridSkeleton /> : null}

      {!isLoading && !error && !artifacts.length ? (
        <div className="mq-card mq-artifact-empty">
          <Layers3 size={24} />
          <h2>{filter === "ALL" && !month ? "No artifacts yet" : "No artifacts match this view"}</h2>
          <p>{filter === "ALL" && !month ? "Generated posts, polls, and carousels will appear here." : "Try another artifact type or month."}</p>
        </div>
      ) : null}

      {!isLoading && artifacts.length ? (
        <>
          <div className="mq-artifact-grid">
            {artifacts.map((artifact) => (
              <ArtifactCard
                key={artifact.id}
                artifact={artifact}
                detailState={details[artifact.id]}
                onVisible={loadDetail}
              />
            ))}
          </div>
          <div className="mq-artifact-pagination" aria-label="Artifact pages">
            <span>Page {page} of {pages}</span>
            <div className="mq-pagination">
              <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => changePage(Math.max(1, page - 1))}><ChevronLeft size={14} /></button>
              <b aria-current="page">{page}</b>
              <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => changePage(Math.min(pages, page + 1))}><ChevronRight size={14} /></button>
            </div>
          </div>
        </>
      ) : null}
    </RedesignShell>
  );
}
