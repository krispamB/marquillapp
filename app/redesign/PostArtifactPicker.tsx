"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, FileText, Search, X } from "lucide-react";
import MarquillSelect from "../../components/ui/MarquillSelect";
import { API_BASE, readApi } from "./api";
import type { ArtifactSummary, ArtifactType, ArtifactsListResponse } from "./artifactTypes";

type ArtifactFilter = "ALL" | ArtifactType;

const typeOptions: Array<{ value: ArtifactFilter; label: string }> = [
  { value: "ALL", label: "All types" },
  { value: "POST", label: "Posts" },
  { value: "POLL", label: "Polls" },
  { value: "DOCUMENT", label: "Documents" },
];

function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function previewCopy(artifact: ArtifactSummary) {
  if (artifact.preview?.commentary?.trim()) return artifact.preview.commentary.trim();
  const firstSlide = artifact.preview?.firstSlide;
  if (firstSlide) {
    const fields = firstSlide.fields as Record<string, unknown>;
    return [fields.eyebrow, fields.title, fields.subtitle].filter((value) => typeof value === "string").join(" · ");
  }
  return "Open this artifact to review its latest READY version.";
}

export default function PostArtifactPicker({
  isOpen,
  hasMedia,
  busy,
  onClose,
  onSelect,
}: {
  isOpen: boolean;
  hasMedia: boolean;
  busy: boolean;
  onClose: () => void;
  onSelect: (artifact: ArtifactSummary) => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [filter, setFilter] = useState<ArtifactFilter>("ALL");
  const [month, setMonth] = useState("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextSearch = searchInput.trim();
    if (nextSearch === search) return;
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      setError(null);
      setPage(1);
      setSearch(nextSearch);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, searchInput]);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ status: "READY", page: String(page) });
    if (filter !== "ALL") params.set("type", filter);
    if (month !== "ALL") params.set("month", month);
    if (search) params.set("search", search);
    readApi<ArtifactsListResponse>(`${API_BASE}/artifacts?${params}`, { signal: controller.signal })
      .then((response) => {
        setError(null);
        setArtifacts(Array.isArray(response.data) ? response.data : []);
        setAvailableMonths(Array.isArray(response.filters?.availableMonths) ? response.filters.availableMonths : []);
        setPages(Math.max(1, response.pages ?? 1));
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setArtifacts([]);
          setError(reason instanceof Error ? reason.message : "Unable to load artifacts.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [filter, isOpen, month, page, search]);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])',
      )).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="mq-artifact-picker-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="mq-artifact-picker" role="dialog" aria-modal="true" aria-labelledby="artifact-picker-title">
        <header>
          <div><span className="mq-eyebrow">Attach artifact</span><h2 id="artifact-picker-title">Choose ready content</h2></div>
          <button type="button" className="mq-icon-button" onClick={onClose} aria-label="Close artifact picker"><X size={18} /></button>
        </header>

        <div className="mq-artifact-picker-tools">
          <label className="mq-artifact-picker-search">
            <Search size={16} />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search artifacts"
              aria-label="Search artifacts"
            />
          </label>
          <MarquillSelect value={filter} onChange={(value) => { setIsLoading(true); setError(null); setFilter(value as ArtifactFilter); setPage(1); }} ariaLabel="Filter artifacts by type" options={typeOptions} />
          <MarquillSelect value={month} onChange={(value) => { setIsLoading(true); setError(null); setMonth(value); setPage(1); }} ariaLabel="Filter artifacts by month" options={[{ value: "ALL", label: "Any month" }, ...availableMonths.map((value) => ({ value, label: monthLabel(value) }))]} />
        </div>

        {hasMedia ? <p className="mq-artifact-picker-warning">Remove attached media before switching to a poll or document.</p> : null}
        {error ? <div className="mq-alert mq-alert-error">{error}</div> : null}

        <div className="mq-artifact-picker-results" aria-busy={isLoading}>
          {isLoading ? Array.from({ length: 4 }, (_, index) => <div className="mq-artifact-pick-skeleton" key={index}><span /><span /><span /></div>) : null}
          {!isLoading && !error && artifacts.map((artifact) => {
            const incompatible = hasMedia && artifact.type !== "POST";
            return (
              <button
                type="button"
                className="mq-artifact-pick-row"
                key={artifact.id}
                disabled={busy || incompatible}
                onClick={() => onSelect(artifact)}
                title={incompatible ? "Remove media before selecting this artifact type" : undefined}
              >
                <span className={`mq-artifact-pick-icon is-${artifact.type.toLowerCase()}`}><FileText size={18} /></span>
                <span className="mq-artifact-pick-copy">
                  <span><strong>{artifact.title?.trim() || "Untitled artifact"}</strong><b>{artifact.type}</b></span>
                  <small>{previewCopy(artifact)}</small>
                  <em><CalendarDays size={12} /> {artifact.updatedAt ? new Date(artifact.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Ready"}</em>
                </span>
              </button>
            );
          })}
          {!isLoading && !error && artifacts.length === 0 ? (
            <div className="mq-artifact-picker-empty"><FileText size={24} /><strong>No READY artifacts found</strong><p>Adjust the search or filters, or create an artifact first.</p><Link href="/artifacts/new" className="mq-primary-button">Create artifact</Link></div>
          ) : null}
        </div>

        <footer>
          <span>Page {page} of {pages}</span>
          <div><button type="button" className="mq-icon-button" disabled={page <= 1 || isLoading} onClick={() => { setIsLoading(true); setPage((value) => value - 1); }} aria-label="Previous artifact page"><ChevronLeft size={16} /></button><button type="button" className="mq-icon-button" disabled={page >= pages || isLoading} onClick={() => { setIsLoading(true); setPage((value) => value + 1); }} aria-label="Next artifact page"><ChevronRight size={16} /></button></div>
        </footer>
      </section>
    </div>
  );
}
