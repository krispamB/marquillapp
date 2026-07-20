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
  Search,
  Trash2,
  type LucideProps,
} from "lucide-react";
import MarquillMark from "../../components/brand/MarquillMark";
import ArtifactDeleteConfirmModal from "./ArtifactDeleteConfirmModal";
import RedesignShell from "./Shell";
import { API_BASE, deleteArtifactRequest, readApi } from "./api";
import useDebouncedSearch from "./useDebouncedSearch";
import { formatRelativeDate } from "./types";
import type {
  ConnectedAccount,
  SubscriptionTier,
  UserProfile,
} from "../lib/types";
import type {
  ArtifactStatus,
  ArtifactSummary,
  ArtifactType,
  ArtifactsListResponse,
} from "./artifactTypes";

type ArtifactFilter = "ALL" | ArtifactType;

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

// Chosen motion direction: kinetic editorial — abstract format cues that reveal no artifact content.
function ArtifactMotionPreview({ type }: { type: ArtifactType }) {
  if (type === "POST") {
    return (
      <div className="mq-artifact-motion mq-artifact-motion-post" aria-hidden="true">
        <span className="mq-artifact-motion-caret" />
        <i /><i /><i /><i /><i />
        <b>✦</b>
      </div>
    );
  }

  if (type === "POLL") {
    return (
      <div className="mq-artifact-motion mq-artifact-motion-poll" aria-hidden="true">
        <span /><span /><span /><span />
        <b />
      </div>
    );
  }

  return (
    <div className="mq-artifact-motion mq-artifact-motion-document" aria-hidden="true">
      <span className="mq-artifact-motion-sheet-1"><i /><i /></span>
      <span className="mq-artifact-motion-sheet-2"><i /><i /></span>
      <span className="mq-artifact-motion-sheet-3"><i /><i /></span>
    </div>
  );
}

function ArtifactCard({
  artifact,
  onDelete,
}: {
  artifact: ArtifactSummary;
  onDelete: (artifact: ArtifactSummary) => void;
}) {
  const format = artifactFormats[artifact.type];

  return (
    <article
      className={`mq-card mq-artifact-card mq-artifact-card-${artifact.type.toLowerCase()}`}
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

      <ArtifactMotionPreview type={artifact.type} />

      <h2 className="mq-artifact-card-title">
        {artifact.title?.trim() || `Untitled ${format.label.toLowerCase()}`}
      </h2>

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
  const [reloadKey, setReloadKey] = useState(0);
  const [deleteArtifact, setDeleteArtifact] = useState<ArtifactSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const prepareSearch = useCallback(() => {
    setIsLoading(true);
    setError(null);
    setPage(1);
  }, []);
  const { clearSearch, search, searchInput, setSearchInput } = useDebouncedSearch(prepareSearch);

  useEffect(() => {
    const controller = new AbortController();

    const params = new URLSearchParams({ page: String(page) });
    if (filter !== "ALL") params.set("type", filter);
    if (month) params.set("month", month);
    if (search) params.set("search", search);

    readApi<ArtifactsListResponse>(`${API_BASE}/artifacts?${params.toString()}`, { signal: controller.signal })
      .then((response) => {
        setError(null);
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
  }, [filter, month, page, reloadKey, search]);

  function changeFilter(nextFilter: ArtifactFilter) {
    setIsLoading(true);
    setError(null);
    setFilter(nextFilter);
    setPage(1);
  }

  function changeMonth(nextMonth: string) {
    setIsLoading(true);
    setError(null);
    setMonth(nextMonth);
    setPage(1);
  }

  function changePage(nextPage: number) {
    setIsLoading(true);
    setError(null);
    setPage(nextPage);
  }

  function clearFilters() {
    setIsLoading(true);
    setError(null);
    setFilter("ALL");
    setMonth("");
    clearSearch();
    setPage(1);
  }

  async function confirmDeleteArtifact() {
    if (!deleteArtifact) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteArtifactRequest(deleteArtifact.id);
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
      topbarExtra={(
        <label className="mq-search-field mq-search-desktop">
          <Search size={15} />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search artifacts…"
            aria-label="Search artifacts"
          />
        </label>
      )}
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
          <label className="mq-filter-select mq-search-mobile mq-artifact-mobile-search">
            <Search size={14} />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search artifacts"
              aria-label="Search artifacts"
            />
          </label>
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
          {artifacts.length || filter !== "ALL" || Boolean(month) || Boolean(search) ? <CreateArtifactLink /> : null}
        </div>
      </div>

      {error ? <div className="mq-alert mq-alert-error" role="alert">{error}</div> : null}
      {isLoading ? <ArtifactGridSkeleton /> : null}

      {!isLoading && !error && !artifacts.length ? (
        filter === "ALL" && !month && !search ? (
          <ArtifactEmptyState />
        ) : (
          <div className="mq-card mq-artifact-filter-empty">
            <Layers3 size={24} />
            <h2>No artifacts match this view</h2>
            <p>Try another search, artifact type, or month.</p>
            <button type="button" className="mq-secondary-button" onClick={clearFilters}>Clear filters</button>
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
