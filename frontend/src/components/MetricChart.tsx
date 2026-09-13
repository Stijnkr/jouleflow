import { ChevronDown, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Series } from "../lib/api";
import { metricChartOption, metricLabel } from "../lib/charts";
import { shortDate, time } from "../lib/format";
import { t } from "../lib/i18n";
import {
  availableMetrics,
  DETAIL_GROUPS,
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
  home: "bg-foreground",
  solar: "bg-solar",
  grid: "bg-grid",
  export: "bg-export",
  l1: "bg-l1",
  l2: "bg-l2",
  l3: "bg-l3",
};

function useSelection(storageKey: string, fallback: string[], catalog: MetricDef[]) {
  // v2: the default changed to consumption, solar and grid, so start from that again.
  const key = `jouleflow-metrics-v2-${storageKey}`;
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
  const available = useMemo(() => availableMetrics(catalog, data?.fields), [catalog, data?.fields]);
  const metrics = useMemo(
    () => selected.map((id) => available.find((m) => m.id === id)).filter((m): m is MetricDef => !!m),
    [selected, available],
  );
  const [showDetail, setShowDetail] = useState(() =>
    selected.some((id) => DETAIL_GROUPS.includes(catalog.find((m) => m.id === id)?.group as MetricGroup)),
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
    for (const m of available) map.set(m.group, [...(map.get(m.group) ?? []), m]);
    return [...map.entries()];
  }, [available]);
  const mainGroups = groups.filter(([g]) => !DETAIL_GROUPS.includes(g));
  const detailGroups = groups.filter(([g]) => DETAIL_GROUPS.includes(g));

  const hasData = Boolean(data?.points.length);

  const chip = (m: MetricDef) => {
    const on = selected.includes(m.id);
    return (
      <button
        key={m.id}
        type="button"
        aria-pressed={on}
        onClick={() => setSelected((current) => toggleMetric(current, m.id, available))}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
          on
            ? "border-foreground/20 bg-muted-surface text-foreground"
            : "border-border text-muted hover:bg-muted-surface/60 hover:text-foreground",
        )}
      >
        <span
          className={cn(
            "rounded-full transition",
            m.color === "home" ? "h-[3px] w-3" : "size-2.5",
            on ? DOT_CLASS[m.color] : "bg-border",
          )}
        />
        {metricLabel(m)}
      </button>
    );
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4 sm:px-6">
        {mainGroups.flatMap(([, items]) => items.map(chip))}
        {detailGroups.length > 0 && (
          <button
            type="button"
            aria-expanded={showDetail}
            onClick={() => setShowDetail((v) => !v)}
            className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] font-medium text-muted transition hover:text-foreground"
          >
            {showDetail ? t("metrics.less") : t("metrics.more")}
            <ChevronDown className={cn("size-3.5 transition", showDetail && "rotate-180")} />
          </button>
        )}
        {option && hasData && (
          <div className="ml-auto flex shrink-0 items-center rounded-lg border border-border">
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
        )}
      </div>
      {showDetail && (
        <div className="flex flex-wrap gap-x-5 gap-y-2 px-5 pt-3 sm:px-6">
          {detailGroups.map(([group, items]) => (
            <div key={group} className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-medium text-subtle">{t(GROUP_LABEL[group])}</span>
              {items.map(chip)}
            </div>
          ))}
        </div>
      )}

      <div className="relative px-3 pt-1 pb-4 sm:px-5">
        <div className="tabular flex min-h-6 items-center px-2 text-xs text-muted">
          {zoom &&
            t(live ? "chart.zoomedLive" : "chart.zoomed", {
              start: rangeLabel(zoom[0], bucketLabel),
              end: rangeLabel(zoom[1], bucketLabel),
            })}
        </div>
        {option && hasData ? (
          <Chart
            option={option}
            replaceMerge={["series", "yAxis", "xAxis", "grid"]}
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
