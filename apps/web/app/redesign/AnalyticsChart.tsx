"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { AnalyticsSeriesPoint } from "../lib/types";
import {
  areaPath,
  chartScale,
  describeSeries,
  formatAxis,
  formatExact,
  formatUtcDate,
  indexAtX,
  metricNoun,
  labelIndices,
  layoutPoints,
  linePath,
  pointSegments,
  type ChartLayout,
} from "./analytics";

const HEIGHT = 208;
const FALLBACK_WIDTH = 640;
const BAR_LIMIT = 28;

function useElementWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(Math.round(node.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width: width > 0 ? width : FALLBACK_WIDTH };
}

export default function AnalyticsChart({
  label,
  series,
  values,
}: {
  label: string;
  series: AnalyticsSeriesPoint[];
  values: Array<number | null>;
}) {
  const { ref, width } = useElementWidth();
  const [active, setActive] = useState<number | null>(null);
  const hintId = useId();
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipWidth, setTipWidth] = useState(112);

  const scale = useMemo(() => chartScale(values), [values]);
  const compactAxis = width < 480;
  const layout: ChartLayout = useMemo(
    () => ({ width, height: HEIGHT, left: compactAxis ? 36 : 44, right: 8, top: 8, bottom: 24 }),
    [width, compactAxis],
  );
  const points = useMemo(() => layoutPoints(values, layout, scale.max), [values, layout, scale.max]);
  const baseline = layout.height - layout.bottom;
  const asBars = values.length <= BAR_LIMIT;
  const band = (layout.width - layout.left - layout.right) / Math.max(1, values.length);
  const barWidth = Math.max(2, Math.min(24, band * 0.68));
  const labels = labelIndices(values.length, width < 480 ? 3 : 5);
  const activePoint = active === null ? null : points[active];
  const activeDate = active === null ? null : series[active]?.date;

  function onPointer(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setActive(indexAtX(event.clientX - rect.left, layout, values.length));
  }

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!values.length) return;
    const last = values.length - 1;
    const keys: Record<string, number> = {
      ArrowLeft: Math.max(0, (active ?? last + 1) - 1),
      ArrowRight: Math.min(last, (active ?? -1) + 1),
      Home: 0,
      End: last,
    };
    if (event.key in keys) {
      event.preventDefault();
      setActive(keys[event.key]);
    } else if (event.key === "Escape") {
      setActive(null);
    }
  }

  // The tooltip is centred on the day, then clamped so its whole box stays inside the chart.
  useLayoutEffect(() => {
    const node = tipRef.current;
    if (!node || active === null) return;
    const measured = Math.ceil(node.getBoundingClientRect().width);
    if (measured > 0) setTipWidth((current) => (current === measured ? current : measured));
  }, [active, label, width]);
  const half = Math.min(tipWidth, width) / 2;
  const tipLeft = activePoint ? Math.min(Math.max(activePoint.x, half), width - half) : 0;

  return (
    <div
      ref={ref}
      className="mq-analytics-chart"
      tabIndex={0}
      aria-describedby={hintId}
      onPointerMove={onPointer}
      onPointerDown={onPointer}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setActive(null);
      }}
      onKeyDown={onKey}
      onBlur={() => setActive(null)}
    >
      <span id={hintId} className="mq-sr-only">Use the arrow keys to move between days.</span>
      <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={describeSeries(label, series, values)}>
        {scale.ticks.map((tick) => {
          const y = layout.top + (baseline - layout.top) * (1 - tick / scale.max);
          return (
            <g key={tick}>
              <line className="mq-analytics-grid" x1={layout.left} x2={width - layout.right} y1={y} y2={y} />
              <text className="mq-analytics-axis" x={layout.left - 8} y={y} textAnchor="end" dominantBaseline="central">
                {formatAxis(tick)}
              </text>
            </g>
          );
        })}
        {labels.map((index) => (
          <text
            key={index}
            className="mq-analytics-axis"
            x={points[index].x}
            y={HEIGHT - 6}
            textAnchor={index === 0 ? "start" : index === values.length - 1 ? "end" : "middle"}
          >
            {formatUtcDate(series[index]?.date ?? "")}
          </text>
        ))}
        {asBars ? (
          points.map((point) => {
            if (point.y === null) return null;
            const isActive = active === point.index;
            return point.value === 0 ? (
              <line
                key={point.index}
                className={`mq-analytics-zero${isActive ? " is-active" : ""}`}
                x1={point.x - barWidth / 2}
                x2={point.x + barWidth / 2}
                y1={baseline - 1}
                y2={baseline - 1}
              />
            ) : (
              <rect
                key={point.index}
                className={`mq-analytics-bar${isActive ? " is-active" : ""}`}
                x={point.x - barWidth / 2}
                y={Math.min(point.y, baseline - 1)}
                width={barWidth}
                height={Math.max(1, baseline - point.y)}
                rx={2}
              />
            );
          })
        ) : (
          <>
            <path className="mq-analytics-area" d={areaPath(points, baseline)} />
            <path className="mq-analytics-line" d={linePath(points)} />
            {pointSegments(points)
              .filter((segment) => segment.length === 1)
              .map((segment) => (
                <circle key={segment[0].index} className="mq-analytics-dot" cx={segment[0].x} cy={segment[0].y as number} r={2} />
              ))}
          </>
        )}
        {activePoint ? (
          <line className="mq-analytics-cursor" x1={activePoint.x} x2={activePoint.x} y1={layout.top} y2={baseline} />
        ) : null}
        {!asBars && activePoint && activePoint.y !== null ? (
          <circle className="mq-analytics-dot" cx={activePoint.x} cy={activePoint.y} r={3.5} />
        ) : null}
      </svg>
      <div ref={tipRef} className="mq-analytics-tip" role="status" aria-live="polite" style={{ left: tipLeft }} hidden={!activePoint}>
        {activePoint && activeDate ? (
          <>
            <span>
              {formatUtcDate(activeDate, { weekday: "short", month: "short", day: "numeric" })}
              {" · "}
              <strong>
                {activePoint.value === null
                  ? "No data"
                  : `${formatExact(activePoint.value)} ${metricNoun(label, activePoint.value)}`}
              </strong>
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
