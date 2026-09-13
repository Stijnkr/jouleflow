import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Chart, type ChartInstance, type ZoomRange } from "./Chart";
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
  const { resolved } = useTheme();
  const [selected, setSelected] = useSelection(storageKey, defaultSelection, catalog);
  const metrics = useMemo(
    () => selected.map((id) => catalog.find((m) => m.id === id)).filter((m): m is MetricDef => !!m),
    [selected, catalog],
  );

  const chartRef = useRef<ChartInstance | null>(null);
  // The chart owns its zoom state; this copy only drives the label and buttons.
  const [zoom, setZoom] = useState<ZoomRange>(null);
  // While zoomed on a live chart, keep showing the data from the moment zooming started.
  const [frozen, setFrozen] = useState<{ data: Series; start: number; end: number } | null>(null);

  const view = frozen ?? (data ? { data, start, end } : null);

  const option = useMemo(
    () =>
      view && metrics.length
        ? metricChartOption(view.data, metrics, {
            start: view.start,
            end: view.end,
            bucketLabel,
            showRange,
          })
        : null,
    // `resolved` is a dependency because chart colours are read from the active theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view?.data, view?.start, view?.end, metrics, bucketLabel, showRange, resolved],
  );

  const handleZoom = (range: ZoomRange) => {
    setZoom(range);
    if (!live) return;
    if (range && !frozen && data) setFrozen({ data, start, end });
    if (!range) setFrozen(null);
  };

  const dispatchZoom = (range: ZoomRange) => {
    const instance = chartRef.current;
    if (!instance) return;
    instance.dispatchAction(
      range
        ? { type: "dataZoom", dataZoomIndex: 0, startValue: range[0], endValue: range[1] }
        : { type: "dataZoom", dataZoomIndex: 0, start: 0, end: 100 },
    );
  };

  const zoomBy = (factor: number) => {
    if (!view) return;
    const full: [number, number] = [view.start * 1000, view.end * 1000];
    const [a, b] = zoom ?? full;
    const span = Math.min((b - a) * factor, full[1] - full[0]);
    if (span >= full[1] - full[0] - 1) return dispatchZoom(null);
    // On a live chart, keep the latest moment in view while it is visible.
    const atEnd = live && b >= full[1] - view.data.bucket_seconds * 1000;
    let [from, to] = atEnd ? [b - span, b] : [(a + b) / 2 - span / 2, (a + b) / 2 + span / 2];
    if (from < full[0]) [from, to] = [full[0], full[0] + span];
    if (to > full[1]) [from, to] = [full[1] - span, full[1]];
    dispatchZoom([from, to]);
  };

  // Switching range or period starts from the full view again.
  useEffect(() => {
    setZoom(null);
    setFrozen(null);
    dispatchZoom(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

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
          <div className="flex min-h-7 items-center justify-end gap-2 px-2 pb-1">
            <span className="tabular mr-auto truncate text-xs text-muted">
              {zoom
                ? t(live ? "chart.zoomedLive" : "chart.zoomed", {
                    start: rangeLabel(zoom[0], bucketLabel),
                    end: rangeLabel(zoom[1], bucketLabel),
                  })
                : t(finePointer() ? "chart.zoomHint" : "chart.zoomHintTouch")}
            </span>
            <div className="flex shrink-0 items-center rounded-lg border border-border">
              <ZoomButton label={t("chart.zoomIn")} onClick={() => zoomBy(0.5)}>
                <ZoomIn className="size-3.5" />
              </ZoomButton>
              <ZoomButton label={t("chart.zoomOut")} onClick={() => zoomBy(2)} disabled={!zoom}>
                <ZoomOut className="size-3.5" />
              </ZoomButton>
              <ZoomButton label={t("chart.resetZoom")} onClick={() => dispatchZoom(null)} disabled={!zoom}>
                <Maximize2 className="size-3.5" />
              </ZoomButton>
            </div>
          </div>
        )}
        {option && hasData ? (
          <Chart
            option={option}
            replaceMerge={["series", "yAxis"]}
            brushZoom
            chartRef={chartRef}
            onZoom={handleZoom}
            onDoubleClick={() => dispatchZoom(null)}
            className="h-72 w-full sm:h-96"
          />
        ) : (
          <div className="grid h-72 place-items-center px-6 text-center text-sm text-muted sm:h-96">
            {!metrics.length ? t("metrics.empty", { max: MAX_UNITS }) : (emptyText ?? t("history.noData"))}
          </div>
        )}
      </div>
    </div>
  );
}

const finePointer = () => window.matchMedia("(pointer: fine)").matches;

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
