import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Chart } from "../components/Chart";
import { Card, CardHeader, cn, IconButton, PageHeader, Segmented, Value } from "../components/ui";
import { api, type Cost, type History, type Period } from "../lib/api";
import { energyBarsOption, powerChartOption } from "../lib/charts";
import { energy, euro, isoDate, longDate, monthName, powerText, shortDate, time, weekday } from "../lib/format";
import { useTheme } from "../lib/theme";

const PERIODS: { value: Period; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

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
    return today ? `Today, ${longDate(h.start)}` : `${longDate(h.start)} ${anchor.getFullYear()}`;
  }
  if (period === "week") return `${shortDate(h.start)} – ${shortDate(h.end - 1)} ${anchor.getFullYear()}`;
  if (period === "month") return `${monthName(h.start, "long")} ${anchor.getFullYear()}`;
  return `${anchor.getFullYear()}`;
}

const PREVIOUS_LABEL: Record<Period, string> = {
  day: "the day before",
  week: "the week before",
  month: "the month before",
  year: "the year before",
};

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
        title="History"
        subtitle={periodLabel(h, period, anchor) || " "}
        actions={
          <>
            <Segmented
              value={period}
              onChange={(p) => {
                setPeriod(p);
                setAnchor(new Date());
              }}
              options={PERIODS}
            />
            <IconButton
              label="Previous"
              onClick={() => setAnchor((a) => shift(a, period, -1))}
              disabled={!canGoPrev}
            >
              <ChevronLeft className="size-4" />
            </IconButton>
            <IconButton
              label="Next"
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
            label="Imported"
            value={h?.totals.import}
            previous={h?.previous.import}
            period={period}
            lowerIsGood
            extra={
              h?.totals.import_low != null
                ? `Low ${energy(h.totals.import_low, 1)} · Normal ${energy(h.totals.import_normal, 1)}`
                : undefined
            }
          />
          <TotalCard
            label="Exported"
            value={h?.totals.export}
            previous={h?.previous.export}
            period={period}
            lowerIsGood={false}
          />
          {h?.totals.cost ? (
            <CostCard cost={h.totals.cost} previous={h.previous.cost} period={period} />
          ) : (
            <TotalCard
              label="Net usage"
              value={h?.totals.net}
              previous={h?.previous.net}
              period={period}
              lowerIsGood
            />
          )}
          <Card className="p-5 sm:p-6">
            <div className="text-sm text-muted">Peak power</div>
            <Value
              className="mt-3"
              value={h?.totals.peak_import_w != null ? (h.totals.peak_import_w / 1000).toFixed(2) : "—"}
              unit="kW"
            />
            <div className="tabular mt-3 truncate text-sm text-muted">
              {h?.totals.peak_export_w
                ? `Export peak ${powerText(h.totals.peak_export_w)}`
                : "Highest import in this period"}
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Energy"
            description={
              period === "day"
                ? "Per hour, in kWh"
                : period === "year"
                  ? "Per month, in kWh"
                  : "Per day, in kWh"
            }
            action={
              <div className="hidden gap-4 text-sm text-muted sm:flex">
                <span className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm bg-import" /> Imported
                </span>
                <span className="flex items-center gap-2">
                  <span className="size-2.5 rounded-sm bg-export" /> Exported
                </span>
              </div>
            }
          />
          <div className="relative px-3 pt-4 pb-4 sm:px-5">
            {barsOption && <Chart option={barsOption} notMerge className="h-64 w-full sm:h-80" />}
            {empty && (
              <div className="absolute inset-0 grid place-items-center text-sm text-muted">
                No data for this period.
              </div>
            )}
          </div>
        </Card>

        {powerOption && (
          <Card>
            <CardHeader title="Power" description="Average per minute" />
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
  let comparison: React.ReactNode = `Energy ${euro(energyCost)} · Fixed ${euro(cost.fixed)}`;
  if (previous && previous.total > 0) {
    const pct = ((cost.total - previous.total) / previous.total) * 100;
    comparison = (
      <span className={pct < 0 ? "text-export" : "text-import"}>
        {Math.abs(Math.round(pct))}% {pct < 0 ? "less" : "more"} than {PREVIOUS_LABEL[period]}
      </span>
    );
  }
  return (
    <Card className="p-5 sm:p-6">
      <div className="text-sm text-muted">Costs</div>
      <Value className="mt-3" value={euro(cost.total)} />
      <div className="tabular mt-3 truncate text-sm text-muted">{comparison}</div>
      {previous && previous.total > 0 && (
        <div className="tabular mt-1 truncate text-xs text-subtle">
          Energy {euro(energyCost)} · Fixed {euro(cost.fixed)}
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
  let footer: React.ReactNode = extra ?? `No data for ${PREVIOUS_LABEL[period]}`;
  if (value != null && previous) {
    const pct = ((value - previous) / Math.abs(previous)) * 100;
    const lower = pct < 0;
    footer = (
      <span className={lower === lowerIsGood ? "text-export" : "text-import"}>
        {Math.abs(Math.round(pct))}% {lower ? "less" : "more"} than {PREVIOUS_LABEL[period]}
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
