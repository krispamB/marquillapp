"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  GalleryHorizontal,
  Layers3,
  Plus,
  Trash2,
  type LucideProps,
} from "lucide-react";
import MarquillMark from "../../components/brand/MarquillMark";
import ArtifactDeleteConfirmModal from "./ArtifactDeleteConfirmModal";
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
  DeleteArtifactResponse,
} from "./artifactTypes";

type ArtifactFilter = "ALL" | ArtifactType;
type DetailState =
  | { status: "loading" }
  | { status: "loaded"; data: ArtifactDetailData }
  | { status: "error" };

function PostEmptyPreview() {
  return (
    <div className="mq-artifact-empty-preview-body mq-artifact-empty-post">
      <span className="mq-artifact-empty-kicker">Drafted by Mark</span>
      <strong>The best career advice I ignored for five years:</strong>
      <p>Stop waiting to feel ready. The work that changed my trajectory started as an imperfect first draft.</p>
      <span className="mq-artifact-empty-post-meta">2 min read · Professional</span>
    </div>
  );
}

function PollEmptyPreview() {
  return (
    <div className="mq-artifact-empty-preview-body mq-artifact-empty-poll">
      <span className="mq-artifact-empty-kicker">Audience pulse</span>
      <strong>What makes a LinkedIn post worth saving?</strong>
      <span>One clear takeaway</span>
      <span>A surprising point of view</span>
      <span>A story that feels real</span>
    </div>
  );
}

function CarouselEmptyPreview() {
  return (
    <div className="mq-artifact-empty-preview-body mq-artifact-empty-carousel">
      <div><small>01</small><strong>5 lessons from building in public</strong></div>
      <div><small>02</small><strong>Start before the story feels finished.</strong></div>
      <div><small>03</small><strong>Share the decision, not just the result.</strong></div>
    </div>
  );
}

type ArtifactFormatDefinition = {
  label: string;
  pluralLabel: string;
  description: string;
  Icon: ComponentType<LucideProps>;
  EmptyPreview: ComponentType;
};

const artifactFilterOrder: ArtifactType[] = ["POST", "DOCUMENT", "POLL"];
const artifactPreviewOrder: ArtifactType[] = ["POST", "POLL", "DOCUMENT"];
const artifactFormats: Record<ArtifactType, ArtifactFormatDefinition> = {
  POST: {
    label: "Post",
    pluralLabel: "Posts",
    description: "A sharp idea, ready for LinkedIn.",
    Icon: FileText,
    EmptyPreview: PostEmptyPreview,
  },
  DOCUMENT: {
    label: "Carousel",
    pluralLabel: "Carousels",
    description: "A story people can swipe through.",
    Icon: GalleryHorizontal,
    EmptyPreview: CarouselEmptyPreview,
  },
  POLL: {
    label: "Poll",
    pluralLabel: "Polls",
    description: "A question built to start a conversation.",
    Icon: BarChart3,
    EmptyPreview: PollEmptyPreview,
  },
};

const filterLabels: Array<{ key: ArtifactFilter; label: string }> = [
  { key: "ALL", label: "All" },
  ...artifactFilterOrder.map((type) => ({ key: type, label: artifactFormats[type].pluralLabel })),
];

function CreateArtifactLink({ iconSize = 15 }: { iconSize?: number }) {
  return (
    <Link href="/artifacts/new" className="mq-primary-button mq-create-artifact-button">
      <Plus size={iconSize} /> Create artifact
    </Link>
  );
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
  onDelete,
}: {
  artifact: ArtifactSummary;
  detailState?: DetailState;
  onVisible: (artifactId: string) => void;
  onDelete: (artifact: ArtifactSummary) => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const shouldEnrich = artifact.status === "READY" && artifact.type !== "POST";
  const format = artifactFormats[artifact.type];

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
          <format.Icon size={13} /> {format.label}
        </span>
        <div className="mq-artifact-card-actions">
          <span className={`mq-artifact-state mq-artifact-state-${artifact.status.toLowerCase()}`}>
            <i /> {statusLabel(artifact.status)}
          </span>
          <button
            type="button"
            className="mq-artifact-card-delete"
            onClick={() => onDelete(artifact)}
            aria-label={`Delete ${artifact.title?.trim() || format.label.toLowerCase()}`}
            title="Delete artifact"
          >
            <Trash2 size={14} />
          </button>
        </div>
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

function ArtifactEmptyState() {
  const [previewType, setPreviewType] = useState<ArtifactType>("POST");
  const tabRefs = useRef<Partial<Record<ArtifactType, HTMLButtonElement | null>>>({});
  const preview = artifactFormats[previewType];
  const Preview = preview.EmptyPreview;

  function showNextFormat() {
    const currentIndex = artifactPreviewOrder.indexOf(previewType);
    setPreviewType(artifactPreviewOrder[(currentIndex + 1) % artifactPreviewOrder.length]);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, type: ArtifactType) {
    const currentIndex = artifactPreviewOrder.indexOf(type);
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % artifactPreviewOrder.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + artifactPreviewOrder.length) % artifactPreviewOrder.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = artifactPreviewOrder.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextType = artifactPreviewOrder[nextIndex];
    setPreviewType(nextType);
    tabRefs.current[nextType]?.focus();
  }

  return (
    <section className="mq-card mq-artifact-empty" aria-labelledby="mq-artifact-empty-title">
      <div className="mq-artifact-empty-copy">
        <div className="mq-artifact-empty-mark">
          <MarquillMark size={34} theme="auto" title="" />
          <span><i /> Mark is ready</span>
        </div>
        <span className="mq-eyebrow">Your content library starts here</span>
        <h2 id="mq-artifact-empty-title">Turn one idea into something worth sharing.</h2>
        <p>Draft with Mark and every finished post, poll, and carousel will stay organized here.</p>
        <div className="mq-artifact-empty-actions">
          <CreateArtifactLink iconSize={16} />
          <button type="button" className="mq-artifact-empty-tour" onClick={showNextFormat}>Explore the formats <span>→</span></button>
        </div>
      </div>

      <div className="mq-artifact-empty-showcase">
        <div
          id="mq-artifact-preview-panel"
          role="tabpanel"
          tabIndex={0}
          aria-labelledby={`mq-artifact-preview-tab-${previewType.toLowerCase()}`}
          className={`mq-artifact-empty-preview mq-artifact-empty-preview-${previewType.toLowerCase()}`}
          aria-live="polite"
        >
          <div className="mq-artifact-empty-preview-head">
            <span><preview.Icon size={15} /> {preview.label}</span>
            <small>Example artifact</small>
          </div>
          <Preview />
        </div>
        <div className="mq-artifact-empty-types" role="tablist" aria-label="Preview artifact formats">
          {artifactPreviewOrder.map((type) => {
            const format = artifactFormats[type];
            const isSelected = previewType === type;
            return (
              <button
                key={type}
                id={`mq-artifact-preview-tab-${type.toLowerCase()}`}
                ref={(node) => { tabRefs.current[type] = node; }}
                type="button"
                role="tab"
                aria-controls="mq-artifact-preview-panel"
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                className={isSelected ? "is-active" : ""}
                onClick={() => setPreviewType(type)}
                onKeyDown={(event) => handleTabKeyDown(event, type)}
              >
                <span><format.Icon size={15} /></span>
                <span><strong>{format.label}</strong><small>{format.description}</small></span>
                <ArrowUpRight size={14} />
              </button>
            );
          })}
        </div>
      </div>
    </section>
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
  const [reloadKey, setReloadKey] = useState(0);
  const [deleteArtifact, setDeleteArtifact] = useState<ArtifactSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
  }, [abortDetailRequests, filter, month, page, reloadKey]);

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

  async function confirmDeleteArtifact() {
    if (!deleteArtifact) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await readApi<DeleteArtifactResponse>(
        `${API_BASE}/artifacts/${encodeURIComponent(deleteArtifact.id)}`,
        { method: "DELETE" },
      );
      detailControllers.current.get(deleteArtifact.id)?.abort();
      detailControllers.current.delete(deleteArtifact.id);
      detailCache.current.delete(deleteArtifact.id);
      setDetails((current) => {
        const next = { ...current };
        delete next[deleteArtifact.id];
        return next;
      });
      const shouldMoveBack = artifacts.length === 1 && page > 1;
      setDeleteArtifact(null);
      setIsDeleting(false);
      setIsLoading(true);
      if (shouldMoveBack) setPage((current) => Math.max(1, current - 1));
      else setReloadKey((current) => current + 1);
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "The artifact could not be deleted.");
      setIsDeleting(false);
    }
  }

  return (
    <RedesignShell
      user={user}
      accounts={connectedAccounts}
      selectedAccountId={primaryAccountId}
      subscription={subscription}
      active="artifacts"
      title="Artifacts"
      topbar={{ credits: {} }}
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
        <div className="mq-artifact-toolbar-actions">
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
          {artifacts.length ? <CreateArtifactLink /> : null}
        </div>
      </div>

      {error ? <div className="mq-alert mq-alert-error" role="alert">{error}</div> : null}
      {isLoading ? <ArtifactGridSkeleton /> : null}

      {!isLoading && !error && !artifacts.length ? (
        filter === "ALL" && !month ? (
          <ArtifactEmptyState />
        ) : (
          <div className="mq-card mq-artifact-filter-empty">
            <Layers3 size={24} />
            <h2>No artifacts match this view</h2>
            <p>Try another artifact type or month.</p>
            <button type="button" className="mq-secondary-button" onClick={() => { changeFilter("ALL"); changeMonth(""); }}>Clear filters</button>
          </div>
        )
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
                onDelete={(selectedArtifact) => {
                  setDeleteError(null);
                  setDeleteArtifact(selectedArtifact);
                }}
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
      <ArtifactDeleteConfirmModal
        isOpen={Boolean(deleteArtifact)}
        isDeleting={isDeleting}
        artifactTitle={deleteArtifact?.title}
        error={deleteError}
        onClose={() => {
          if (isDeleting) return;
          setDeleteArtifact(null);
          setDeleteError(null);
        }}
        onConfirm={() => void confirmDeleteArtifact()}
      />
    </RedesignShell>
  );
}
