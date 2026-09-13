import { useMemo, useState } from "react";
import type { Series } from "../lib/api";
import { metricChartOption, metricLabel } from "../lib/charts";
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
}: Props) {
  const { resolved } = useTheme();
  const [selected, setSelected] = useSelection(storageKey, defaultSelection, catalog);
  const metrics = useMemo(
    () => selected.map((id) => catalog.find((m) => m.id === id)).filter((m): m is MetricDef => !!m),
    [selected, catalog],
  );

  const option = useMemo(
    () =>
      data && metrics.length
        ? metricChartOption(data, metrics, { start, end, bucketLabel, showRange })
        : null,
    // `resolved` is a dependency because chart colours are read from the active theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, metrics, start, end, bucketLabel, showRange, resolved],
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
        {option && hasData ? (
          <Chart option={option} notMerge className="h-64 w-full sm:h-80" />
        ) : (
          <div className="grid h-64 place-items-center px-6 text-center text-sm text-muted sm:h-80">
            {!metrics.length ? t("metrics.empty", { max: MAX_UNITS }) : (emptyText ?? t("history.noData"))}
          </div>
        )}
      </div>
    </div>
  );
}
