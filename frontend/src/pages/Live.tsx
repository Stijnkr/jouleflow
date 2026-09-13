import { useQuery } from "@tanstack/react-query";
import { Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EnergyFlow } from "../components/EnergyFlow";
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

function useSolarNow() {
  const { data } = useQuery({ queryKey: ["inverters"], queryFn: api.inverters, refetchInterval: 5000 });
  const inverters = data?.inverters ?? [];
  return {
    hasSolar: inverters.length > 0,
    solarW: inverters.reduce((sum, i) => sum + (i.fresh ? (i.power ?? 0) : 0), 0),
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
          <Card className="px-5 pt-6 pb-5 sm:px-8 sm:pt-8 sm:pb-6">
            <EnergyFlow netW={current?.power_net ?? null} solarW={solarW} hasSolar={hasSolar}>
              <PlugConsumers />
            </EnergyFlow>
          </Card>
          <TodayCard summary={summary.data} hasSolar={hasSolar} />
        </div>

        <MeasurementsCard solarW={hasSolar ? solarW : null} />

        <PhasesCard reading={current} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------- today

/** A part-to-whole bar with its parts listed underneath. */
function Split({
  total,
  parts,
}: {
  total: number | null | undefined;
  parts: { label: string; value: number | null | undefined; color: string }[];
}) {
  const sum = parts.reduce((s, p) => s + Math.max(p.value ?? 0, 0), 0);
  return (
    <>
      <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted-surface">
        {total != null &&
          sum > 0 &&
          parts.map((p) =>
            (p.value ?? 0) > 0 ? (
              <div
                key={p.label}
                className={cn("h-full transition-[width] duration-700 first:rounded-l-full last:rounded-r-full", p.color)}
                style={{ width: `${((p.value ?? 0) / sum) * 100}%` }}
              />
            ) : null,
          )}
      </div>
      <dl className="mt-3 flex flex-col gap-1.5 text-sm">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center gap-2">
            <span className={cn("size-2.5 shrink-0 rounded-sm", p.color)} />
            <dt className="text-muted">{p.label}</dt>
            <dd className="tabular ml-auto font-medium">{energy(p.value)} kWh</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function Headline({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-sm font-medium text-muted">{label}</h3>
      <div className="tabular flex items-baseline gap-1">
        <span className="text-[28px] leading-none font-semibold tracking-tight">{value}</span>
        {unit && <span className="text-sm text-muted">{unit}</span>}
      </div>
    </div>
  );
}

function Change({ pct, lowerIsGood }: { pct: number | null | undefined; lowerIsGood: boolean }) {
  if (pct == null) return null;
  const lower = pct < 0;
  return (
    <p className={cn("mt-2 text-[13px]", lower === lowerIsGood ? "text-export" : "text-muted")}>
      {t(lower ? "change.lessThanYesterday" : "change.moreThanYesterday", { pct: Math.abs(Math.round(pct)) })}
    </p>
  );
}

const RATE_LABEL = { normal: "rate.normal", low: "rate.low", single: "rate.single" } as const;

function TodayCard({ summary, hasSolar }: { summary?: Summary; hasSolar: boolean }) {
  const today = summary?.today;
  const solar = hasSolar ? today?.solar : null;
  const withSolar = solar != null;
  const selfUsed = withSolar ? Math.max(solar - (today?.export ?? 0), 0) : null;
  const used = today?.consumption ?? null;
  const cost = summary?.cost_today;
  const rate = summary?.rate_now;

  return (
    <Card className="flex flex-col">
      <CardHeader title={t("today.title")} />
      <div className="flex flex-1 flex-col divide-y divide-border px-5 sm:px-6">
        {withSolar ? (
          <>
            <section className="py-5">
              <Headline label={t("today.used")} value={energy(used)} unit="kWh" />
              <Split
                total={used}
                parts={[
                  { label: t("today.fromSolar"), value: selfUsed, color: "bg-solar" },
                  { label: t("today.fromGrid"), value: today?.import, color: "bg-grid" },
                ]}
              />
              {used != null && used > 0 && selfUsed != null && (
                <p className="mt-2 text-[13px] text-muted">
                  {t("today.selfSufficient", { pct: Math.round((selfUsed / used) * 100) })}
                </p>
              )}
            </section>
            <section className="py-5">
              <Headline label={t("today.produced")} value={energy(solar)} unit="kWh" />
              <Split
                total={solar}
                parts={[
                  { label: t("today.selfUsed"), value: selfUsed, color: "bg-solar" },
                  { label: t("today.exported"), value: today?.export, color: "bg-export" },
                ]}
              />
              <Change pct={summary?.change_pct.solar} lowerIsGood={false} />
            </section>
          </>
        ) : (
          <section className="py-5">
            <Headline label={t("today.imported")} value={energy(today?.import)} unit="kWh" />
            <Change pct={summary?.change_pct.import} lowerIsGood />
            <div className="mt-5">
              <Headline label={t("today.exported")} value={energy(today?.export)} unit="kWh" />
            </div>
            {today?.gas != null && today.gas > 0 && (
              <div className="mt-5">
                <Headline label={t("live.gasToday")} value={energy(today.gas)} unit="m³" />
              </div>
            )}
          </section>
        )}
        {cost && (
          <section className="py-5">
            <Headline label={t("today.cost")} value={euro(cost.total)} unit="" />
            <p className="tabular mt-2 text-[13px] text-muted">
              {rate
                ? t("live.rateNow", { price: euro(rate.import_price, 4), rate: t(RATE_LABEL[rate.rate]) })
                : t("live.fixedIncluded", { amount: euro(cost.fixed) })}
            </p>
            {cost.export_cost > 0 && (
              <p className="tabular mt-1 text-[13px] text-muted">
                {t("live.feedInCostToday", { amount: euro(cost.export_cost) })}
              </p>
            )}
          </section>
        )}
      </div>
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
