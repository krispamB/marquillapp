"use client";

import type { CSSProperties } from "react";
import type { AnalyticsAudience } from "../lib/types";
import { formatAudienceValue, formatExact } from "./analytics";

/** Under this many followers in a facet, counts read better than percentages. */
const SMALL_FACET_TOTAL = 100;

export default function AnalyticsAudienceCard({
  audience,
  loading,
  failed = false,
  supported = true,
  onRetry,
}: {
  audience?: AnalyticsAudience;
  loading: boolean;
  failed?: boolean;
  /** False for accounts that have no audience breakdown (a personal account). */
  supported?: boolean;
  onRetry?: () => void;
}) {
  if (!audience && loading) {
    return (
      <section className="mq-card mq-analytics-card" aria-label="Audience" aria-busy="true">
        <div className="mq-card-heading"><span className="mq-title">Audience</span></div>
        <div className="mq-analytics-card-body">
          {[0, 1, 2].map((row) => <span key={row} className="mq-analytics-skel mq-analytics-skel-row" />)}
        </div>
      </section>
    );
  }
  if (!audience && failed && supported) {
    return (
      <section className="mq-card mq-analytics-card" aria-label="Audience">
        <div className="mq-card-heading"><span className="mq-title">Audience</span></div>
        <div className="mq-analytics-card-body mq-analytics-inline-state">
          <p>Audience could not be loaded.</p>
          <button type="button" className="mq-secondary-button" onClick={onRetry}>Try again</button>
        </div>
      </section>
    );
  }
  if (!audience || audience.access !== "ok" || !audience.supported || !audience.facets.length) return null;

  return (
    <section className="mq-card mq-analytics-card" aria-label="Audience">
      <div className="mq-card-heading has-sub">
        <div className="mq-analytics-trend-title">
          <span className="mq-title">Audience</span>
          <span className="mq-analytics-trend-total">All current followers, by count and share. Not limited to the selected range.</span>
        </div>
      </div>
      <div className="mq-analytics-facets">
        {audience.facets.map((facet) => {
          const smallFacet = facet.items.reduce((sum, item) => sum + item.count, 0) < SMALL_FACET_TOTAL;
          return (
          <div key={facet.key} className="mq-analytics-facet">
            <h3>{facet.label}</h3>
            <ul>
              {facet.items.map((item) => {
                const value = formatAudienceValue(item.count, item.share, smallFacet);
                const spoken = `${formatExact(item.count)} ${item.count === 1 ? "follower" : "followers"}, ${value.split(" · ")[1]}`;
                return (
                <li key={item.label}>
                  <span className="mq-analytics-facet-label">{item.label}</span>
                  <span className="mq-analytics-facet-value" title={spoken}>
                    <span aria-hidden="true">{value}</span>
                    <span className="mq-sr-only">{spoken}</span>
                  </span>
                  <span
                    className="mq-analytics-facet-bar"
                    style={{ "--share": `${Math.min(100, Math.max(0, item.share))}%` } as CSSProperties}
                    aria-hidden="true"
                  />
                </li>
                );
              })}
            </ul>
          </div>
          );
        })}
      </div>
    </section>
  );
}
