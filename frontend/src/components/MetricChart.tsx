import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Series } from "../lib/api";
import { metricChartOption, metricLabel } from "../lib/charts";
import { shortDate, time } from "../lib/format";
import { t } from "../lib/i18n";
import {
  GROUP_LABEL,
  MAX_UNITS,
  toggleMetric,
  type MetricDef,
  type MetricGroup,
} from "../lib/metrics";
import { useTheme } from "../lib/theme";
import { Chart } from "./Chart";
import { cn } from "./ui";

const DOT_CLASS: Record<MetricDef["color"], string> = {
  import: "bg-import",
  export: "bg-export",
  l1: "bg-l1",
  l2: "bg-l2",
  l3: "bg-l3",
};

function useSelection(storageKey: string, fallback: string[], catalog: MetricDef[]) {
  const key = `jouleflow-metrics-${storageKey}`;
  const [selected, setSelected] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? "null");
      if (Array.isArray(stored)) {
        const known = stored.filter((id) => catalog.some((m) => m.id === id));
        return known;
      }
    } catch {
      /* storage unavailable or invalid */
    }
    return fallback;
  });

  const update = (change: (current: string[]) => string[]) => {
    setSelected((current) => {
      const next = change(current);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };
  return [selected, update] as const;
}

type Props = {
  data: Series | undefined;
  catalog: MetricDef[];
  defaultSelection: string[];
  /** Remembers the selection per chart, e.g. "live" or "history". */
  storageKey: string;
  start: number;
  end: number;
  bucketLabel: "time" | "date" | "datetime";
  /** Show min/max per bucket in the tooltip (only meaningful for rollups). */
  showRange?: boolean;
  emptyText?: string;
  className?: string;
  /** The chart follows new data (live); zooming pauses that until the zoom is reset. */
  live?: boolean;
  /** Changing this resets the zoom, e.g. when switching range or period. */
  resetKey?: string;
};

export function MetricChart({
  data,
  catalog,
  defaultSelection,
  storageKey,
  start,
  end,
  bucketLabel,
  showRange = true,
  emptyText,
  className,
  live = false,
  resetKey,
}: Props) {
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  useEffect(() => setZoom(null), [resetKey]);

  const fullStart = start * 1000;
  const fullEnd = end * 1000;
  // While zoomed on a live chart, keep the window where the user left it.
  const [frozenEnd, setFrozenEnd] = useState<number | null>(null);
  const windowStart = fullStart;
  const windowEnd = zoom && live ? (frozenEnd ?? fullEnd) : fullEnd;

  const applyZoom = (range: [number, number] | null) => {
    if (!range) {
      setZoom(null);
      setFrozenEnd(null);
      return;
    }
    const minSpan = Math.max((data?.bucket_seconds ?? 60) * 12, 60) * 1000;
    let [a, b] = range;
    if (b - a < minSpan) {
      const mid = (a + b) / 2;
      [a, b] = [mid - minSpan / 2, mid + minSpan / 2];
    }
    a = Math.max(a, windowStart);
    b = Math.min(b, windowEnd);
    if (b - a >= (windowEnd - windowStart) * 0.98) {
      setZoom(null);
      setFrozenEnd(null);
      return;
    }
    if (!zoom && live) setFrozenEnd(fullEnd);
    setZoom([a, b]);
  };

  const zoomBy = (factor: number) => {
    const [a, b] = zoom ?? [windowStart, windowEnd];
    // On a live chart, keep the most recent moment in view while it is visible.
    const atEnd = live && b >= windowEnd - (data?.bucket_seconds ?? 1) * 1000;
    const span = (b - a) * factor;
    applyZoom(atEnd ? [b - span, b] : [(a + b) / 2 - span / 2, (a + b) / 2 + span / 2]);
  };
  const { resolved } = useTheme();
  const [selected, setSelected] = useSelection(storageKey, defaultSelection, catalog);
  const metrics = useMemo(
    () => selected.map((id) => catalog.find((m) => m.id === id)).filter((m): m is MetricDef => !!m),
    [selected, catalog],
  );

  const option = useMemo(
    () =>
      data && metrics.length
        ? metricChartOption(data, metrics, {
            start: windowStart / 1000,
            end: windowEnd / 1000,
            bucketLabel,
            showRange,
            zoom,
          })
        : null,
    // `resolved` is a dependency because chart colours are read from the active theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, metrics, windowStart, windowEnd, bucketLabel, showRange, zoom, resolved],
  );

  const groups = useMemo(() => {
    const map = new Map<MetricGroup, MetricDef[]>();
    for (const m of catalog) map.set(m.group, [...(map.get(m.group) ?? []), m]);
    return [...map.entries()];
  }, [catalog]);

  const hasData = Boolean(data?.points.length);

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-x-5 gap-y-2.5 px-5 pt-4 sm:px-6">
        {groups.map(([group, items]) => (
          <div key={group} className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-xs font-medium text-subtle">{t(GROUP_LABEL[group])}</span>
            {items.map((m) => {
              const on = selected.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSelected((current) => toggleMetric(current, m.id, catalog))}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition",
                    on
                      ? "border-foreground/25 bg-muted-surface text-foreground"
                      : "border-border text-muted hover:bg-muted-surface/60 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "size-2 rounded-full transition",
                      on ? DOT_CLASS[m.color] : "bg-border",
                    )}
                  />
                  {metricLabel(m)}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="relative px-3 pt-2 pb-4 sm:px-5">
        {option && hasData && (
          <div className="flex items-center justify-end gap-2 px-2 pb-1">
            {zoom && (
              <span className="tabular mr-auto truncate text-xs text-muted">
                {t(live ? "chart.zoomedLive" : "chart.zoomed", {
                  start: rangeLabel(zoom[0], bucketLabel),
                  end: rangeLabel(zoom[1], bucketLabel),
                })}
              </span>
            )}
            <div className="flex items-center rounded-lg border border-border" title={t("chart.zoomHint")}>
              <ZoomButton label={t("chart.zoomIn")} onClick={() => zoomBy(0.5)}>
                <ZoomIn className="size-3.5" />
              </ZoomButton>
              <ZoomButton label={t("chart.zoomOut")} onClick={() => zoomBy(2)} disabled={!zoom}>
                <ZoomOut className="size-3.5" />
              </ZoomButton>
              <ZoomButton label={t("chart.resetZoom")} onClick={() => applyZoom(null)} disabled={!zoom}>
                <Maximize2 className="size-3.5" />
              </ZoomButton>
            </div>
          </div>
        )}
        {option && hasData ? (
          <Chart
            option={option}
            notMerge
            onDataZoom={(range) => applyZoom(range)}
            className="h-64 w-full sm:h-80"
          />
        ) : (
          <div className="grid h-64 place-items-center px-6 text-center text-sm text-muted sm:h-80">
            {!metrics.length ? t("metrics.empty", { max: MAX_UNITS }) : (emptyText ?? t("history.noData"))}
          </div>
        )}
      </div>
    </div>
  );
}

function rangeLabel(ms: number, bucketLabel: Props["bucketLabel"]): string {
  const ts = ms / 1000;
  return bucketLabel === "time" ? time(ts) : `${shortDate(ts)} ${time(ts)}`;
}

function ZoomButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-7 place-items-center text-muted transition first:rounded-l-lg last:rounded-r-lg hover:bg-muted-surface hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}
