"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import type { AnalyticsAccountType, AnalyticsPost, AnalyticsPostsResponse } from "../lib/types";
import {
  formatCompact,
  formatExact,
  formatPercent,
  formatUtcDate,
  postsCoverageNote,
  RATE_OVER_100_NOTE,
  postValueLabel,
  sortPosts,
  visiblePostColumns,
  type PostSortKey,
  type SortDirection,
} from "./analytics";

function cell(key: PostSortKey, post: AnalyticsPost) {
  const value = post[key];
  if (value === null) return "—";
  return key === "engagementRate" ? formatPercent(value) : formatCompact(value);
}

function exact(key: PostSortKey, post: AnalyticsPost) {
  const value = post[key];
  return value === null ? undefined : key === "engagementRate" ? formatPercent(value) : formatExact(value);
}

function Excerpt({ post }: { post: AnalyticsPost }) {
  const text = post.text.trim() || "Untitled post";
  if (post.url) {
    return <a href={post.url} className="mq-analytics-excerpt" target="_blank" rel="noreferrer">{text}</a>;
  }
  if (post.postId) return <Link href={`/posts/${post.postId}/edit`} className="mq-analytics-excerpt">{text}</Link>;
  return <span className="mq-analytics-excerpt">{text}</span>;
}

function PostMeta({ post }: { post: AnalyticsPost }) {
  return (
    <small className="mq-analytics-post-meta">
      <span>{formatUtcDate(post.publishedAt, { month: "short", day: "numeric", year: "numeric" })}</span>
      {post.postId && post.url ? (
        <Link href={`/posts/${post.postId}/edit`} className="mq-analytics-edit-link">Edit in Marquill</Link>
      ) : null}
    </small>
  );
}

export default function AnalyticsPosts({
  response,
  loading,
  failed,
  accountType,
  onRetry,
}: {
  response?: AnalyticsPostsResponse;
  loading: boolean;
  failed: boolean;
  accountType: AnalyticsAccountType;
  onRetry: () => void;
}) {
  const [sort, setSort] = useState<{ key: PostSortKey; direction: SortDirection }>({
    key: "impressions",
    direction: "desc",
  });
  const posts = useMemo(
    () => sortPosts(response?.posts ?? [], sort.key, sort.direction),
    [response, sort],
  );
  const columns = useMemo(() => visiblePostColumns(posts), [posts]);
  const mobileColumns = columns.filter((column) =>
    ["impressions", "reactions", "comments", "reposts", "clicks", "engagementRate"].includes(column.key),
  );

  function toggle(key: PostSortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  }

  let body;
  if (!response && loading) {
    body = (
      <div className="mq-analytics-card-body" aria-busy="true" aria-label="Loading top posts">
        {[0, 1, 2].map((row) => <span key={row} className="mq-analytics-skel mq-analytics-skel-row" />)}
      </div>
    );
  } else if (!response && failed) {
    body = (
      <div className="mq-analytics-card-body mq-analytics-inline-state">
        <p>Top posts could not be loaded.</p>
        <button type="button" className="mq-secondary-button" onClick={onRetry}>Try again</button>
      </div>
    );
  } else if (!response || response.access !== "ok") {
    body = <p className="mq-empty">Top posts are not available right now.</p>;
  } else if (!posts.length) {
    body = (
      <div className="mq-analytics-card-body mq-analytics-inline-state">
        <p>No posts were published in this period.</p>
        <Link href="/posts/new" className="mq-secondary-button">Create a post</Link>
      </div>
    );
  } else {
    body = (
      <>
        <div className="mq-analytics-table-wrap">
          <table className="mq-analytics-table">
            <thead>
              <tr>
                <th scope="col">Post</th>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className="is-num"
                    aria-sort={sort.key === column.key ? (sort.direction === "desc" ? "descending" : "ascending") : "none"}
                  >
                    <button type="button" onClick={() => toggle(column.key)}>
                      {column.label}
                      {sort.key === column.key
                        ? (sort.direction === "desc" ? <ArrowDown size={12} aria-hidden="true" /> : <ArrowUp size={12} aria-hidden="true" />)
                        : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.urn}>
                  <td>
                    <div className="mq-analytics-post-cell">
                      <span className="mq-analytics-post-copy">
                        <Excerpt post={post} />
                        <PostMeta post={post} />
                      </span>
                      <span className="mq-analytics-post-slot">
                        {post.url ? (
                          <a href={post.url} target="_blank" rel="noreferrer" className="mq-icon-button" aria-label="View on LinkedIn" title="View on LinkedIn">
                            <ExternalLink size={14} />
                          </a>
                        ) : null}
                      </span>
                    </div>
                  </td>
                  {columns.map((column) => (
                    <td key={column.key} className="is-num" title={exact(column.key, post)}>{cell(column.key, post)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mq-analytics-post-list">
          {posts.map((post) => (
            <li key={post.urn}>
              <Excerpt post={post} />
              <PostMeta post={post} />
              <span className="mq-analytics-post-numbers">
                {mobileColumns.map((column) => (
                  <span key={column.key}>
                    <span className="mq-analytics-post-value">{cell(column.key, post)}</span>{" "}
                    {postValueLabel(column, post[column.key])}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
        {posts.some((post) => post.engagementRate !== null && post.engagementRate > 100) ? (
          <p className="mq-analytics-footnote">{RATE_OVER_100_NOTE}</p>
        ) : null}
        {response.truncated ? <p className="mq-analytics-footnote">Showing the top {posts.length} posts.</p> : null}
      </>
    );
  }

  return (
    <section className="mq-card mq-analytics-card" aria-label="Top posts">
      <div className="mq-card-heading has-sub">
        <div className="mq-analytics-trend-title">
          <span className="mq-title">Top posts</span>
          {response && response.access === "ok" ? (
            <span className="mq-analytics-trend-total">
              {postsCoverageNote(response.coverage, accountType === "ORGANIZATION")}
            </span>
          ) : null}
        </div>
      </div>
      {body}
    </section>
  );
}
