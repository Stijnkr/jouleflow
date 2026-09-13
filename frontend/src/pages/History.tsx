import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Chart } from "../components/Chart";
import { Card, CardHeader, cn, IconButton, PageHeader, Segmented, Value } from "../components/ui";
import { api, type Cost, type History, type Period } from "../lib/api";
import { energyBarsOption, phaseChartOption, powerChartOption, type PhaseMetric } from "../lib/charts";
import { energy, euro, isoDate, kw, longDate, monthName, num, powerText, shortDate, time, weekday } from "../lib/format";
import { t } from "../lib/i18n";
import { useTheme } from "../lib/theme";

const PERIODS = ["day", "week", "month", "year"] as const;

function shift(d: Date, period: Period, dir: 1 | -1): Date {
  const n = new Date(d);
  if (period === "day") n.setDate(n.getDate() + dir);
  else if (period === "week") n.setDate(n.getDate() + 7 * dir);
  else if (period === "month") {
    n.setDate(1);
    n.setMonth(n.getMonth() + dir);
  } else {
    n.setMonth(0, 1);
    n.setFullYear(n.getFullYear() + dir);
  }
  return n;
}

function periodLabel(h: History | undefined, period: Period, anchor: Date): string {
  if (!h) return "";
  if (period === "day") {
    const today = isoDate(new Date()) === isoDate(anchor);
    return today ? t("history.today", { date: longDate(h.start) }) : `${longDate(h.start)} ${anchor.getFullYear()}`;
  }
  if (period === "week") return `${shortDate(h.start)} – ${shortDate(h.end - 1)} ${anchor.getFullYear()}`;
  if (period === "month") return `${monthName(h.start, "long")} ${anchor.getFullYear()}`;
  return `${anchor.getFullYear()}`;
}

const PREVIOUS_LABEL = {
  day: "previous.day",
  week: "previous.week",
  month: "previous.month",
  year: "previous.year",
} as const;

function compare(pct: number, period: Period): string {
  return t(pct < 0 ? "compare.less" : "compare.more", {
    pct: Math.abs(Math.round(pct)),
    previous: t(PREVIOUS_LABEL[period]),
  });
}

export function HistoryPage() {
  const [period, setPeriod] = useState<Period>("day");
  const [anchor, setAnchor] = useState(() => new Date());
  const { resolved } = useTheme();

  const query = useQuery({
    queryKey: ["history", period, isoDate(anchor)],
    queryFn: () => api.history(period, isoDate(anchor)),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const h = query.data;
  const now = Date.now() / 1000;
  const canGoNext = h ? h.end <= now : false;
  const canGoPrev = h ? h.first_data != null && h.start > h.first_data : false;

  const barsOption = useMemo(() => {
    if (!h) return null;
    const label = (ts: number) =>
      period === "day"
        ? time(ts).slice(0, 2)
        : period === "week"
          ? weekday(ts)
          : period === "month"
            ? new Date(ts * 1000).getDate().toString()
            : monthName(ts);
    const tooltipLabel = (ts: number) =>
      period === "day"
        ? `${time(ts)} – ${time(ts + 3600)}`
        : period === "year"
          ? `${monthName(ts, "long")}`
          : `${weekday(ts)} ${shortDate(ts)}`;
    return energyBarsOption(h.bars, label, tooltipLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h, period, resolved]);

  const powerOption = useMemo(
    () =>
      h && period === "day" && h.power.length
        ? powerChartOption(h.power, { start: h.start, end: h.end, bucketLabel: "time" })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [h, period, resolved],
  );

  const empty = h != null && h.totals.import == null;

  return (
    <>
      <PageHeader
        title={t("history.title")}
        subtitle={periodLabel(h, period, anchor) || " "}
        actions={
          <>
            <Segmented
              value={period}
              onChange={(p) => {
                setPeriod(p);
                setAnchor(new Date());
              }}
              options={PERIODS.map((p) => ({ value: p, label: t(`period.${p}` as const) }))}
            />
            <IconButton
              label={t("common.previous")}
              onClick={() => setAnchor((a) => shift(a, period, -1))}
              disabled={!canGoPrev}
            >
              <ChevronLeft className="size-4" />
            </IconButton>
            <IconButton
              label={t("common.next")}
              onClick={() => setAnchor((a) => shift(a, period, 1))}
              disabled={!canGoNext}
            >
              <ChevronRight className="size-4" />
            </IconButton>
          </>
        }
      />

      <div
        className={cn(
          "mx-auto flex max-w-[1400px] flex-col gap-4 p-4 transition-opacity sm:gap-6 sm:p-8",
          query.isPlaceholderData && "opacity-60",
        )}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 xl:grid-cols-4">
          <TotalCard
            label={t("history.imported")}
            value={h?.totals.import}
            previous={h?.previous.import}
            period={period}
            lowerIsGood
            extra={
              h?.totals.import_low != null
                ? t("history.lowNormal", { low: energy(h.totals.import_low, 1), normal: energy(h.totals.import_normal, 1) })
                : undefined
            }
          />
          <TotalCard
            label={t("history.exported")}
            value={h?.totals.export}
            previous={h?.previous.export}
            period={period}
            lowerIsGood={false}
          />
          {h?.totals.cost ? (
            <CostCard cost={h.totals.cost} previous={h.previous.cost} period={period} />
          ) : (
            <TotalCard
              label={t("history.netUsage")}
              value={h?.totals.net}
              previous={h?.previous.net}
              period={period}
              lowerIsGood
            />
          )}
          <Card className="p-5 sm:p-6">
            <div className="text-sm text-muted">{t("history.peakPower")}</div>
            <Value
              className="mt-3"
              value={kw(h?.totals.peak_import_w)}
              unit="kW"
            />
            <div className="tabular mt-3 truncate text-sm text-muted">
              {h?.totals.peak_export_w
                ? t("history.exportPeak", { power: powerText(h.totals.peak_export_w) })
                : t("history.highestImport")}
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader
            title={t("history.energy")}
            description={
              period === "day"
                ? t("history.perHour")
                : period === "year"
                  ? t("history.perMonth")
                  : t("history.perDay")
            }
            action={
              <div className="hidden gap-4 text-sm text-muted sm:flex">
                <span className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm bg-import" /> {t("chart.imported")}
                </span>
                <span className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm bg-export" /> {t("chart.exported")}
                </span>
              </div>
            }
          />
          <div className="relative px-3 pt-4 pb-4 sm:px-5">
            {barsOption && <Chart option={barsOption} notMerge className="h-64 w-full sm:h-80" />}
            {empty && (
              <div className="absolute inset-0 grid place-items-center text-sm text-muted">
                {t("history.noData")}
              </div>
            )}
          </div>
        </Card>

        <PhaseCard period={period} anchor={isoDate(anchor)} />

        {powerOption && (
          <Card>
            <CardHeader title={t("live.power")} description={t("history.powerAverage")} />
            <div className="px-3 pt-4 pb-4 sm:px-5">
              <Chart option={powerOption} notMerge className="h-56 w-full sm:h-72" />
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function CostCard({ cost, previous, period }: { cost: Cost; previous: Cost | null; period: Period }) {
  const energyCost = cost.import - cost.export_credit + cost.export_cost + cost.gas;
  const breakdown = t("live.costBreakdown", { energy: euro(energyCost), fixed: euro(cost.fixed) });
  let comparison: React.ReactNode = breakdown;
  if (previous && previous.total > 0) {
    const pct = ((cost.total - previous.total) / previous.total) * 100;
    comparison = (
      <span className={pct < 0 ? "text-export" : "text-import"}>{compare(pct, period)}</span>
    );
  }
  return (
    <Card className="p-5 sm:p-6">
      <div className="text-sm text-muted">{t("history.costs")}</div>
      <Value className="mt-3" value={euro(cost.total)} />
      <div className="tabular mt-3 truncate text-sm text-muted">{comparison}</div>
      {previous && previous.total > 0 && (
        <div className="tabular mt-1 truncate text-xs text-subtle">
          {breakdown}
        </div>
      )}
    </Card>
  );
}

function TotalCard({
  label,
  value,
  previous,
  period,
  lowerIsGood,
  extra,
}: {
  label: string;
  value: number | null | undefined;
  previous: number | null | undefined;
  period: Period;
  lowerIsGood: boolean;
  extra?: string;
}) {
  let footer: React.ReactNode = extra ?? t("compare.noData", { previous: t(PREVIOUS_LABEL[period]) });
  if (value != null && previous) {
    const pct = ((value - previous) / Math.abs(previous)) * 100;
    const lower = pct < 0;
    footer = (
      <span className={lower === lowerIsGood ? "text-export" : "text-import"}>
        {compare(pct, period)}
      </span>
    );
  }
  return (
    <Card className="p-5 sm:p-6">
      <div className="text-sm text-muted">{label}</div>
      <Value className="mt-3" value={energy(value)} unit="kWh" />
      <div className="tabular mt-3 truncate text-sm text-muted">{footer}</div>
      {extra && value != null && previous ? (
        <div className="tabular mt-1 truncate text-xs text-subtle">{extra}</div>
      ) : null}
    </Card>
  );
}

const RESOLUTION: Record<number, "resolution.minute" | "resolution.hour" | "resolution.day"> = {
  60: "resolution.minute",
  3600: "resolution.hour",
  86400: "resolution.day",
};

const METRIC_DESCRIPTION = {
  p: "phases.descPower",
  i: "phases.descCurrent",
  v: "phases.descVoltage",
} as const;

function PhaseCard({ period, anchor }: { period: Period; anchor: string }) {
  const { resolved } = useTheme();
  const [metric, setMetric] = useState<PhaseMetric>("i");
  const query = useQuery({
    queryKey: ["phases", period, anchor],
    queryFn: () => api.phases(period, anchor),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const data = query.data;

  const option = useMemo(
    () =>
      data && data.points.length
        ? phaseChartOption(data, metric, { bucketLabel: period === "day" ? "time" : "date" })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, metric, period, resolved],
  );

  // Extremes per phase over the whole period.
  const summaries = [1, 2, 3].map((ph) => {
    if (!data) return null;
    const values = (name: string) => {
      const idx = data.fields.indexOf(name);
      return data.points.map((p) => p[idx]).filter((v): v is number => v != null);
    };
    const lows = values(`${metric}_l${ph}_min`);
    const highs = values(`${metric}_l${ph}_max`);
    if (!highs.length) return null;
    const min = lows.length ? Math.min(...lows) : null;
    const max = Math.max(...highs);
    if (metric === "i") return t("phases.summaryCurrent", { max: num(max, 1) });
    if (metric === "v") return t("phases.summaryVoltage", { min: num(min ?? max, 0), max: num(max, 0) });
    return t("phases.summaryPower", { min: num((min ?? 0) / 1000, 2), max: num(max / 1000, 2) });
  });

  return (
    <Card>
      <CardHeader
        title={t("phases.title")}
        description={
          data
            ? t(METRIC_DESCRIPTION[metric], { resolution: t(RESOLUTION[data.bucket_seconds] ?? "resolution.hour") })
            : undefined
        }
        action={
          <Segmented<PhaseMetric>
            size="sm"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "p", label: t("phases.metricPower") },
              { value: "i", label: t("phases.metricCurrent") },
              { value: "v", label: t("phases.metricVoltage") },
            ]}
          />
        }
      />
      <div className="relative px-3 pt-4 sm:px-5">
        {option ? (
          <Chart option={option} notMerge className="h-56 w-full sm:h-72" />
        ) : (
          <div className="grid h-56 place-items-center text-sm text-muted sm:h-72">
            {t("history.noData")}
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 border-t border-border px-5 py-4 text-sm sm:px-6">
        {summaries.map((summary, i) => (
          <div key={i} className="flex min-w-0 items-center gap-2">
            <span className={cn("size-2.5 shrink-0 rounded-sm", ["bg-l1", "bg-l2", "bg-l3"][i])} />
            <span className="font-medium">L{i + 1}</span>
            <span className="tabular truncate text-muted">{summary ?? "—"}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
