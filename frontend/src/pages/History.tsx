import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Chart } from "../components/Chart";
import { EnergyBalance } from "../components/EnergyBalance";
import { EnergyFlow, energyFlow, flowSentence } from "../components/EnergyFlow";
import { MetricChart } from "../components/MetricChart";
import { Card, CardHeader, cn, IconButton, PageHeader, Segmented } from "../components/ui";
import { api, type FeedInSummary, type History, type Period } from "../lib/api";
import { energyBarsOption } from "../lib/charts";
import { energy, euro, isoDate, isoToDate, longDate, monthName, shortDate, time, weekday } from "../lib/format";
import { t } from "../lib/i18n";
import { DEFAULT_P1_SELECTION, P1_METRICS } from "../lib/metrics";
import type { MessageKey } from "../locales/en";
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
    return energyBarsOption(h.bars, label, tooltipLabel, h.totals.solar != null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h, period, resolved]);


  const empty = h != null && h.totals.import == null;
  const withSolar = h?.totals.solar != null;
  const periodFlow = h ? energyFlow(h.totals) : null;

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
        <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(320px,2fr)]">
          <Card className="px-5 pt-5 pb-5 sm:px-6 sm:pt-6">
            <h2 className="text-[15px] font-semibold tracking-tight">{t("flow.title")}</h2>
            <p className="mt-3 max-w-[52ch] text-lg leading-snug font-medium tracking-tight text-balance sm:text-xl">
              {flowSentence(periodFlow, "kWh", withSolar)}
            </p>
            {h?.previous.consumption != null && h.totals.consumption != null && h.previous.consumption > 0 && (
              <p className={cn("mt-1.5 text-sm", h.totals.consumption < h.previous.consumption ? "text-export" : "text-muted")}>
                {compare(((h.totals.consumption - h.previous.consumption) / h.previous.consumption) * 100, period)}
              </p>
            )}
            <div className="mt-4">
              <EnergyFlow values={periodFlow} unit="kWh" hasSolar={withSolar} animate={false} />
            </div>
          </Card>
          <Card className="flex flex-col px-5 pt-5 pb-1 sm:px-6 sm:pt-6">
            <h2 className="mb-5 text-[15px] font-semibold tracking-tight">{t("balance.keyFigures")}</h2>
            <EnergyBalance
              flow={periodFlow}
              hasSolar={withSolar}
              importSplit={
                h?.totals.import_low != null
                  ? t("history.lowNormal", { low: energy(h.totals.import_low, 1), normal: energy(h.totals.import_normal, 1) })
                  : undefined
              }
              peak={h ? { importW: h.totals.peak_import_w, exportW: h.totals.peak_export_w } : undefined}
              gasM3={h?.totals.gas}
              cost={h?.totals.cost?.total}
              costNote={
                h?.totals.cost && (
                  <>
                    {t("live.costBreakdown", {
                      energy: euro(
                        h.totals.cost.import - h.totals.cost.export_credit + h.totals.cost.export_cost + h.totals.cost.gas,
                      ),
                      fixed: euro(h.totals.cost.fixed),
                    })}
                    {h.previous.cost && h.previous.cost.total > 0 && (
                      <>
                        <br />
                        {compare(((h.totals.cost.total - h.previous.cost.total) / h.previous.cost.total) * 100, period)}
                      </>
                    )}
                  </>
                )
              }
            />
          </Card>
        </div>

        <Card>
          <CardHeader
            title={t("history.energy")}
            description={
              withSolar
                ? period === "day"
                  ? t("history.usedPerHour")
                  : period === "year"
                    ? t("history.usedPerMonth")
                    : t("history.usedPerDay")
                : period === "day"
                  ? t("history.perHour")
                  : period === "year"
                    ? t("history.perMonth")
                    : t("history.perDay")
            }
            action={
              <div className="hidden gap-4 text-sm text-muted sm:flex">
                {(withSolar
                  ? [
                      ["bg-solar", t("chart.fromSolar")],
                      ["bg-grid", t("chart.fromGrid")],
                      ["bg-export", t("chart.exported")],
                    ]
                  : [
                      ["bg-grid", t("chart.imported")],
                      ["bg-export", t("chart.exported")],
                    ]
                ).map(([color, label]) => (
                  <span key={label} className="flex items-center gap-2">
                    <span className={cn("size-2.5 rounded-sm", color)} /> {label}
                  </span>
                ))}
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

        {h?.totals.feed_in && <FeedInCard summary={h.totals.feed_in} />}

        <PlugsCard period={period} anchor={isoDate(anchor)} />

        <MeasurementsCard period={period} anchor={isoDate(anchor)} />

      </div>
    </>
  );
}

const RESOLUTION: Record<number, MessageKey> = {
  5: "resolution.fiveSeconds",
  60: "resolution.minute",
  900: "resolution.quarter",
  3600: "resolution.hour",
  86400: "resolution.day",
};

function MeasurementsCard({ period, anchor }: { period: Period; anchor: string }) {
  const query = useQuery({
    queryKey: ["history-series", period, anchor],
    queryFn: () => api.historySeries(period, anchor),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const data = query.data;

  return (
    <Card>
      <CardHeader
        title={t("metrics.powerTitle")}
        description={
          data
            ? t("metrics.historyDescription", {
                resolution: t(RESOLUTION[data.bucket_seconds] ?? "resolution.hour"),
              })
            : undefined
        }
      />
      <MetricChart
        data={data}
        catalog={P1_METRICS}
        defaultSelection={DEFAULT_P1_SELECTION}
        storageKey="history"
        resetKey={`${period}-${anchor}`}
        start={data?.start ?? 0}
        end={data?.end ?? 0}
        bucketLabel={period === "day" ? "time" : period === "week" ? "datetime" : "date"}
      />
    </Card>
  );
}

function FeedInCard({ summary }: { summary: FeedInSummary }) {
  const later = summary.after_netting;
  const stats = [
    {
      label: t("feedIn.exported"),
      value: `${energy(summary.exported_kwh)} kWh`,
    },
    {
      label: t("feedIn.cost"),
      value: euro(-summary.cost),
      detail: t("feedIn.costDetail", { price: euro(summary.cost_per_kwh, 4) }),
      tone: "text-import",
    },
    {
      label: summary.netting ? t("feedIn.creditNetting") : t("feedIn.creditCompensation"),
      value: euro(summary.credit),
      detail: summary.netting ? t("feedIn.creditDetail") : t("feedIn.creditDetailCompensation"),
      tone: "text-export",
    },
    {
      label: t("feedIn.net"),
      value: euro(summary.net),
      detail: t("feedIn.netDetail", { price: euro(summary.net_per_kwh, 4) }),
      tone: summary.net < 0 ? "text-import" : "text-foreground",
    },
  ];

  return (
    <Card>
      <CardHeader title={t("feedIn.title")} description={t("feedIn.description")} />
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 px-5 pt-5 pb-5 sm:px-6 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="min-w-0">
            <div className="truncate text-sm text-muted">{stat.label}</div>
            <div className={cn("tabular mt-1 text-2xl font-semibold tracking-tight", stat.tone)}>
              {stat.value}
            </div>
            {stat.detail && <div className="tabular mt-1 text-xs leading-snug text-subtle">{stat.detail}</div>}
          </div>
        ))}
      </div>
      {later && (
        <p className="tabular mx-5 mb-5 rounded-lg bg-muted-surface px-4 py-3 text-sm text-muted sm:mx-6">
          {t(later.net < 0 ? "feedIn.outlookLoss" : "feedIn.outlook", {
            date: isoToDate(later.from),
            net: euro(Math.abs(later.net)),
            compensation: euro(later.compensation, 3),
            cost: euro(later.cost, 3),
            perKwh: euro(later.net_per_kwh, 4),
            nowPerKwh: euro(summary.net_per_kwh, 4),
          })}
        </p>
      )}
    </Card>
  );
}

function PlugsCard({ period, anchor }: { period: Period; anchor: string }) {
  const { data } = useQuery({
    queryKey: ["plug-history", period, anchor],
    queryFn: () => api.plugHistory(period, anchor),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const plugs = data?.plugs ?? [];
  if (!plugs.length) return null;
  const max = Math.max(...plugs.map((p) => p.energy_kwh), 0.001);

  return (
    <Card>
      <CardHeader title={t("plugs.title")} description={t("plugs.historyDescription")} />
      <div className="flex flex-col gap-4 px-5 pt-5 pb-5 sm:px-6">
        {plugs.map((plug) => (
          <div key={plug.id}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium">{plug.name}</span>
              <span className="tabular font-semibold">{energy(plug.energy_kwh)} kWh</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted-surface">
              <div
                className="h-full rounded-full bg-import transition-[width] duration-500"
                style={{ width: `${(plug.energy_kwh / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
