import { useQuery } from "@tanstack/react-query";
import { Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EnergyBalance } from "../components/EnergyBalance";
import { EnergyFlow, energyFlow, flowSentence, powerFlow } from "../components/EnergyFlow";
import { MetricChart } from "../components/MetricChart";
import { PlugSwitch } from "../components/PlugSwitch";
import { Card, CardHeader, cn, IconButton, PageHeader, Segmented } from "../components/ui";
import { api, type PowerRange, type Reading, type Series, type Summary } from "../lib/api";
import { energy, euro, kw, longDate, num, powerText, time } from "../lib/format";
import { useLive, useNow } from "../lib/live";
import { DEFAULT_P1_SELECTION, P1_METRICS, readingToPoint } from "../lib/metrics";
import { t } from "../lib/i18n";
import { useTheme } from "../lib/theme";

const RANGE_SECONDS: Record<PowerRange, number> = {
  "15m": 900,
  hour: 3600,
  "6h": 6 * 3600,
  day: 86400,
  week: 7 * 86400,
};

// Windows short enough to append every live reading.
const LIVE_APPEND = new Set<PowerRange>(["15m", "hour", "6h"]);
const RANGE_LABEL = {
  "15m": "live.range15m",
  hour: "live.rangeHour",
  "6h": "live.range6h",
  day: "live.rangeDay",
  week: "live.rangeWeek",
} as const;

/** Current solar power: the sum of what the inverters report. null when one of them is
 * unreachable for a reason other than sleeping, since then we don't know. */
function useSolarNow(): { hasSolar: boolean; solarW: number | null } {
  const { data } = useQuery({ queryKey: ["inverters"], queryFn: api.inverters, refetchInterval: 5000 });
  const inverters = data?.inverters ?? [];
  const unknown = inverters.some((i) => i.power == null);
  return {
    hasSolar: inverters.length > 0,
    solarW: unknown ? null : inverters.reduce((sum, i) => sum + (i.power ?? 0), 0),
  };
}

export function LivePage() {
  const { reading } = useLive();
  const { resolved, toggle } = useTheme();
  const now = useNow(5000);
  const { hasSolar, solarW } = useSolarNow();

  const summary = useQuery({
    queryKey: ["summary"],
    queryFn: api.summary,
    refetchInterval: 15_000,
  });
  const live = useQuery({ queryKey: ["live"], queryFn: api.live, refetchInterval: 30_000 });
  const current = reading ?? live.data?.reading ?? null;

  return (
    <>
      <PageHeader
        title={t("live.title")}
        subtitle={
          <>
            {longDate(now)}
            {current && <> · {t("live.updated", { time: time(current.ts, true) })}</>}
          </>
        }
        actions={
          <IconButton label={t("common.toggleTheme")} onClick={toggle}>
            {resolved === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
          </IconButton>
        }
      />

      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4 sm:gap-6 sm:p-8">
        <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(320px,2fr)]">
          <FlowCard reading={current} summary={summary.data} hasSolar={hasSolar} solarW={solarW} />
          <TodayCard summary={summary.data} hasSolar={hasSolar} />
        </div>

        <MeasurementsCard solarW={hasSolar ? solarW : null} />

        <PhasesCard reading={current} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------- flow & today

function FlowCard({
  reading,
  summary,
  hasSolar,
  solarW,
}: {
  reading: Reading | null;
  summary?: Summary;
  hasSolar: boolean;
  solarW: number | null;
}) {
  const [mode, setMode] = useState<"now" | "today">("now");
  const values =
    mode === "now"
      ? reading
        ? powerFlow(reading.power_net, hasSolar ? solarW : 0)
        : null
      : summary
        ? energyFlow({ ...summary.today, solar: hasSolar ? summary.today.solar : null })
        : null;
  const unit = mode === "now" ? "W" : "kWh";

  return (
    <Card className="px-5 pt-5 pb-5 sm:px-6 sm:pt-6">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-[15px] font-semibold tracking-tight">{t("flow.title")}</h2>
        <Segmented
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: "now", label: t("flow.now") },
            { value: "today", label: t("flow.today") },
          ]}
        />
      </div>
      <p className="mt-3 max-w-[52ch] text-lg leading-snug font-medium tracking-tight text-balance sm:text-xl">
        {flowSentence(values, unit, hasSolar)}
      </p>
      <div className="mt-4">
        <EnergyFlow values={values} unit={unit} hasSolar={hasSolar} animate={mode === "now"} />
      </div>
      <PlugConsumers />
    </Card>
  );
}

const RATE_LABEL = { normal: "rate.normal", low: "rate.low", single: "rate.single" } as const;

function TodayCard({ summary, hasSolar }: { summary?: Summary; hasSolar: boolean }) {
  const flow = summary ? energyFlow({ ...summary.today, solar: hasSolar ? summary.today.solar : null }) : null;
  const cost = summary?.cost_today;
  const rate = summary?.rate_now;
  return (
    <Card className="flex flex-col px-5 pt-5 pb-1 sm:px-6 sm:pt-6">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">{t("today.title")}</h2>
        <span className="text-[13px] text-muted">{t("balance.keyFigures")}</span>
      </div>
      <EnergyBalance
        flow={flow}
        hasSolar={hasSolar && summary?.today.solar != null}
        gasM3={summary?.today.gas}
        cost={cost?.total}
        costNote={
          cost && (
            <>
              {rate
                ? t("live.rateNow", { price: euro(rate.import_price, 4), rate: t(RATE_LABEL[rate.rate]) })
                : t("live.fixedIncluded", { amount: euro(cost.fixed) })}
              {cost.export_cost > 0 && (
                <>
                  <br />
                  {t("live.feedInCostToday", { amount: euro(cost.export_cost) })}
                </>
              )}
            </>
          )
        }
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------- measurements

const LIVE_BUCKET_LABEL = { "15m": "time", hour: "time", "6h": "time", day: "time", week: "datetime" } as const;

function MeasurementsCard({ solarW }: { solarW: number | null }) {
  const [range, setRange] = useState<PowerRange>("hour");
  const { subscribe } = useLive();
  const query = useQuery({
    queryKey: ["series", range],
    queryFn: () => api.series(range),
    refetchInterval: LIVE_APPEND.has(range) ? 5 * 60_000 : 60_000,
  });
  const [data, setData] = useState<Series | undefined>();
  const [end, setEnd] = useState(() => Math.floor(Date.now() / 1000));
  const solarRef = useRef(solarW);
  solarRef.current = solarW;

  useEffect(() => {
    if (query.data) {
      setData(query.data);
      setEnd(query.data.end);
    }
  }, [query.data]);

  // Append live readings to the short windows. Points closer together than the
  // window's bucket size are skipped so the chart keeps a steady density.
  useEffect(() => {
    if (!LIVE_APPEND.has(range)) return;
    return subscribe((r) => {
      setEnd(r.ts);
      setData((prev) => {
        if (!prev) return prev;
        const last = prev.points[prev.points.length - 1];
        if (last && r.ts < (last[0] as number) + prev.bucket_seconds) return prev;
        const cutoff = r.ts - RANGE_SECONDS[range];
        const points = prev.points.filter((p) => (p[0] as number) >= cutoff);
        points.push(readingToPoint(r, prev.fields, last, solarRef.current));
        return { ...prev, points };
      });
    });
  }, [range, subscribe]);

  return (
    <Card>
      <div className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:pt-6">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">{t("metrics.powerTitle")}</h2>
          <p className="mt-1 text-sm text-muted">{t(RANGE_LABEL[range])}</p>
        </div>
        <Segmented
          value={range}
          onChange={setRange}
          size="sm"
          options={[
            { value: "15m", label: t("range.15m") },
            { value: "hour", label: t("range.hour") },
            { value: "6h", label: t("range.6h") },
            { value: "day", label: t("range.day") },
            { value: "week", label: t("range.week") },
          ]}
        />
      </div>
      <MetricChart
        data={data}
        catalog={P1_METRICS}
        defaultSelection={DEFAULT_P1_SELECTION}
        storageKey="live"
        start={end - RANGE_SECONDS[range]}
        end={end}
        bucketLabel={LIVE_BUCKET_LABEL[range]}
        showRange={!LIVE_APPEND.has(range)}
        live={LIVE_APPEND.has(range)}
        resetKey={range}
        emptyText={query.isSuccess ? t("live.collecting") : undefined}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------- phases

// A typical Dutch 3×25 A connection: 25 A × 230 V per phase.
const PHASE_MAX_W = 5750;

function PhasesCard({ reading }: { reading: Reading | null }) {
  const phases = reading?.phases.filter((p) => p.power != null) ?? [];
  return (
    <Card>
      <CardHeader title={t("phases.title")} description={t("phases.description")} />
      <div className="grid grid-cols-1 gap-5 px-5 pt-5 pb-6 sm:grid-cols-3 sm:gap-8 sm:px-6">
        {phases.length === 0 && <p className="text-sm text-muted">{t("phases.none")}</p>}
        {phases.map((p, i) => {
          const w = p.power ?? 0;
          const pct = Math.min(Math.abs(w) / PHASE_MAX_W, 1) * 100;
          const exporting = w < 0;
          return (
            <div key={i}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium text-muted">L{i + 1}</span>
                <span className="tabular font-semibold whitespace-nowrap">
                  {exporting && "−"}
                  {kw(Math.abs(w))} kW
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted-surface">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-700",
                    exporting ? "bg-export" : "bg-grid",
                  )}
                  style={{ width: `${Math.max(pct, w === 0 ? 0 : 1.5)}%` }}
                />
              </div>
              {(p.voltage != null || p.current != null) && (
                <div className="tabular mt-1.5 text-xs text-subtle">
                  {[
                    p.voltage != null && `${num(p.voltage, 0)} V`,
                    p.current != null && `${num(p.current, 0)} A`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function PlugConsumers() {
  const { data } = useQuery({ queryKey: ["plugs"], queryFn: api.plugs, refetchInterval: 5000 });
  const plugs = data?.plugs ?? [];
  if (!plugs.length) return null;
  return (
    <div className="mt-6 border-t border-border pt-4">
      <div className="mb-1 text-[13px] font-medium text-muted">{t("plugs.consumers")}</div>
      <div className="flex flex-col divide-y divide-border">
        {plugs.map((plug) => (
          <div key={plug.id} className="flex items-center gap-3 py-2.5 text-sm">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                plug.connected ? (plug.is_on ? "bg-export" : "bg-subtle") : "bg-import",
              )}
            />
            <span className="min-w-0 flex-1 truncate font-medium">{plug.display_name}</span>
            <span className="tabular text-muted">
              {plug.connected
                ? `${powerText(plug.power)} · ${energy(plug.today_kwh ?? plug.energy_today_kwh)} kWh`
                : t("plugs.offline")}
            </span>
            <PlugSwitch plug={plug} />
          </div>
        ))}
      </div>
    </div>
  );
}
