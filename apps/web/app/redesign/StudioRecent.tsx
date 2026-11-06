"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { API_BASE, readApi } from "./api";
import { artifactTypeIcons, artifactTypeLabels } from "./artifactPresentation";
import type { ArtifactSummary, ArtifactsListResponse } from "./artifactTypes";
import { formatRelativeDate } from "./types";

const RECENT_LIMIT = 3;

function loadRecent(signal: AbortSignal) {
  return readApi<ArtifactsListResponse>(`${API_BASE}/artifacts?page=1`, { signal });
}

/**
 * The user's latest artifacts above the Studio prompt on phones. Loading, empty, and
 * failed all render nothing, so the Studio falls back to its hero and form.
 */
export default function StudioRecent({
  load = loadRecent,
}: {
  load?: (signal: AbortSignal) => Promise<ArtifactsListResponse | undefined | null>;
}) {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setArtifacts(Array.isArray(response?.data) ? response.data.slice(0, RECENT_LIMIT) : []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setArtifacts([]);
      });
    return () => controller.abort();
  }, [load]);

  if (!artifacts.length) return null;

  return (
    <section className="mq-card mq-studio-recent" aria-label="Recent artifacts">
      <div className="mq-studio-recent-head">
        <span>Recent</span>
        <Link href="/artifacts">View all</Link>
      </div>
      {artifacts.map((artifact) => {
        const Icon = artifactTypeIcons[artifact.type] ?? artifactTypeIcons.POST;
        const label = artifactTypeLabels[artifact.type] ?? "Post";
        return (
          <Link key={artifact.id} href={`/artifacts/${encodeURIComponent(artifact.id)}`} className="mq-list-row mq-studio-recent-row">
            <span className="mq-row-icon" aria-hidden="true"><Icon /></span>
            <strong>{artifact.title?.trim() || `Untitled ${label.toLowerCase()}`}</strong>
            <time dateTime={artifact.updatedAt}>{formatRelativeDate(artifact.updatedAt)}</time>
          </Link>
        );
      })}
    </section>
  );
}
