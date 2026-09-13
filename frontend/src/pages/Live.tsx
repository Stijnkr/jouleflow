import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Moon, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Chart } from "../components/Chart";
import { Card, CardHeader, cn, IconButton, PageHeader, Segmented, Value } from "../components/ui";
import { api, type PowerPoint, type PowerRange, type Reading, type Summary } from "../lib/api";
import { powerChartOption } from "../lib/charts";
import { energy, kw, longDate, power, powerText, time } from "../lib/format";
import { useLive, useNow } from "../lib/live";
import { useTheme } from "../lib/theme";

const RANGE_SECONDS: Record<PowerRange, number> = { hour: 3600, day: 86400, week: 7 * 86400 };
const RANGE_LABEL: Record<PowerRange, string> = {
  hour: "Last 60 minutes, updating live",
  day: "Last 24 hours",
  week: "Last 7 days",
};

export function LivePage() {
  const { reading } = useLive();
  const { resolved, toggle } = useTheme();
  const [range, setRange] = useState<PowerRange>("hour");
  const now = useNow(5000);

  const summary = useQuery({
    queryKey: ["summary"],
    queryFn: api.summary,
    refetchInterval: 15_000,
  });
  const live = useQuery({ queryKey: ["live"], queryFn: api.live, refetchInterval: 30_000 });
  const current = reading ?? live.data?.reading ?? null;
  const hasGas = Boolean(live.data?.device.details.has_gas);

  return (
    <>
      <PageHeader
        title="Live"
        subtitle={
          <>
            {longDate(now)}
            {current && <> · updated {time(current.ts, true)}</>}
          </>
        }
        actions={
          <>
            <Segmented
              value={range}
              onChange={setRange}
              options={[
                { value: "hour", label: "Hour" },
                { value: "day", label: "Day" },
                { value: "week", label: "Week" },
              ]}
            />
            <IconButton label="Toggle theme" onClick={toggle}>
              {resolved === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
            </IconButton>
          </>
        }
      />

      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4 sm:gap-6 sm:p-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 xl:grid-cols-4">
          <NowCard reading={current} summary={summary.data} />
          <ImportedCard summary={summary.data} />
          <ExportedCard summary={summary.data} />
          {hasGas ? <GasCard summary={summary.data} /> : <NetCard summary={summary.data} />}
        </div>

        <PowerCard range={range} />

        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-[3fr_2fr]">
          <EnergyFlowCard reading={current} />
          <PhasesCard reading={current} />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------- stat cards

function StatCard({
  label,
  icon,
  value,
  unit,
  valueClass,
  footer,
}: {
  label: string;
  icon?: React.ReactNode;
  value: string;
  unit: string;
  valueClass?: string;
  footer: React.ReactNode;
}) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-1.5 text-sm text-muted">
        {icon}
        {label}
      </div>
      <Value className={cn("mt-3", valueClass)} value={value} unit={unit} />
      <div className="tabular mt-3 truncate text-sm text-muted">{footer}</div>
    </Card>
  );
}

function Change({ pct, lowerIsGood }: { pct: number | null | undefined; lowerIsGood: boolean }) {
  if (pct == null) return <>No data for yesterday yet</>;
  const lower = pct < 0;
  const good = lower === lowerIsGood;
  return (
    <span className={good ? "text-export" : "text-import"}>
      {Math.abs(Math.round(pct))}% {lower ? "less" : "more"} than yesterday
    </span>
  );
}

function NowCard({ reading, summary }: { reading: Reading | null; summary?: Summary }) {
  const exporting = reading != null && reading.power_net < 0;
  const [value, unit] = power(reading?.power_net);
  const peak = summary?.peak_import;
  return (
    <StatCard
      label={exporting ? "Exporting now" : "Drawing now"}
      icon={
        exporting ? (
          <ArrowUp className="size-4 text-export" />
        ) : (
          <ArrowDown className="size-4 text-import" />
        )
      }
      value={value}
      unit={unit}
      valueClass={exporting ? "text-export" : "text-import"}
      footer={
        peak ? `Peak today ${powerText(peak.w)} at ${time(peak.ts)}` : "Waiting for today's data"
      }
    />
  );
}

function ImportedCard({ summary }: { summary?: Summary }) {
  return (
    <StatCard
      label="Imported today"
      value={energy(summary?.today.import)}
      unit="kWh"
      footer={<Change pct={summary?.change_pct.import} lowerIsGood />}
    />
  );
}

function ExportedCard({ summary }: { summary?: Summary }) {
  const w = summary?.export_window;
  return (
    <StatCard
      label="Exported today"
      value={energy(summary?.today.export)}
      unit="kWh"
      footer={
        w ? `Sent back ${time(w.start)} – ${time(w.end)}` : "Nothing sent back yet today"
      }
    />
  );
}

function GasCard({ summary }: { summary?: Summary }) {
  return (
    <StatCard
      label="Gas today"
      value={energy(summary?.today.gas)}
      unit="m³"
      footer={<Change pct={summary?.change_pct.gas} lowerIsGood />}
    />
  );
}

function NetCard({ summary }: { summary?: Summary }) {
  const imp = summary?.today.import;
  const exp = summary?.today.export;
  const net = imp == null ? null : imp - (exp ?? 0);
  return (
    <StatCard
      label="Net today"
      value={net == null ? "—" : energy(Math.abs(net))}
      unit="kWh"
      footer={
        net == null
          ? "Import minus export"
          : net >= 0
            ? "More imported than exported"
            : "More exported than imported"
      }
    />
  );
}

// ---------------------------------------------------------------------------- power chart

function PowerCard({ range }: { range: PowerRange }) {
  const { subscribe } = useLive();
  const { resolved } = useTheme();
  const query = useQuery({
    queryKey: ["power", range],
    queryFn: () => api.power(range),
    refetchInterval: range === "hour" ? 5 * 60_000 : 60_000,
  });
  const [points, setPoints] = useState<PowerPoint[]>([]);
  const [end, setEnd] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (query.data) {
      setPoints(query.data.points);
      setEnd(query.data.end);
    }
  }, [query.data]);

  // Append live readings to the hour view.
  useEffect(() => {
    if (range !== "hour") return;
    return subscribe((r) => {
      setEnd(r.ts);
      setPoints((prev) => {
        const last = prev[prev.length - 1];
        if (last && r.ts <= last[0]) return prev;
        const cutoff = r.ts - RANGE_SECONDS.hour;
        const next = prev[0] && prev[0][0] < cutoff ? prev.filter((p) => p[0] >= cutoff) : prev;
        return [...next, [r.ts, r.power_import, r.power_export]];
      });
    });
  }, [range, subscribe]);

  const hasExport = points.some((p) => p[2] > 0);
  const option = useMemo(
    () =>
      powerChartOption(points, {
        start: end - RANGE_SECONDS[range],
        end,
        bucketLabel: range === "week" ? "datetime" : "time",
      }),
    // `resolved` is a dependency because chart colours are read from the active theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, end, range, resolved],
  );

  return (
    <Card>
      <CardHeader
        title="Power"
        description={RANGE_LABEL[range]}
        action={
          <div className="flex gap-2">
            <Legend color="bg-import" label="Grid import" />
            {hasExport && <Legend color="bg-export" label="Grid export" />}
          </div>
        }
      />
      <div className="relative px-3 pt-4 pb-4 sm:px-5">
        <Chart option={option} className="h-64 w-full sm:h-80" />
        {query.isSuccess && points.length === 0 && (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted">
            Collecting data… the chart fills up as readings come in.
          </div>
        )}
      </div>
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="hidden items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm text-muted sm:inline-flex">
      <span className={cn("h-0.5 w-2.5 rounded-full", color)} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------- energy flow

function FlowNode({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-28 shrink-0 rounded-lg border border-border px-4 py-3 sm:w-36 sm:px-5 sm:py-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="tabular mt-1 text-lg font-semibold sm:text-xl">{value}</div>
    </div>
  );
}

function EnergyFlowCard({ reading }: { reading: Reading | null }) {
  const net = reading?.power_net ?? 0;
  const exporting = net < 0;
  const idle = reading == null || Math.abs(net) < 5;
  const color = exporting ? "var(--export)" : "var(--import)";
  const value = reading ? `${kw(Math.abs(net))} kW` : "—";

  return (
    <Card>
      <CardHeader
        title="Energy flow"
        description={
          idle ? "Grid and home, right now" : exporting ? "Home to grid, right now" : "Grid to home, right now"
        }
      />
      <div className="px-5 pt-6 pb-5 sm:px-6 sm:pb-6">
        <div className="flex items-center gap-3 sm:gap-5">
          <FlowNode label="Grid" value={value} />
          <svg className="h-6 min-w-0 flex-1" preserveAspectRatio="none" viewBox="0 0 100 24">
            <line
              x1="2"
              y1="12"
              x2="94"
              y2="12"
              stroke={idle ? "var(--border)" : color}
              strokeWidth="2"
              strokeDasharray="8 6"
              vectorEffect="non-scaling-stroke"
              className={cn(!idle && "flow-line", exporting && "reverse")}
            />
            {!idle && (
              <path
                d={exporting ? "M6 6 L0 12 L6 18" : "M94 6 L100 12 L94 18"}
                fill="none"
                stroke={color}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
              />
            )}
          </svg>
          <FlowNode label="Home" value={value} />
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-2 text-sm text-muted">
          {["Solar", "Battery", "EV charger"].map((d) => (
            <span key={d} className="rounded-full border border-dashed border-border px-3 py-1.5">
              {d}
            </span>
          ))}
          <span className="ml-1">appear here once connected</span>
        </div>
      </div>
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
      <CardHeader title="Phases" description="Balance across L1, L2 and L3" />
      <div className="flex flex-col gap-5 px-5 pt-6 pb-6 sm:px-6">
        {phases.length === 0 && <p className="text-sm text-muted">No phase data available.</p>}
        {phases.map((p, i) => {
          const w = p.power ?? 0;
          const pct = Math.min(Math.abs(w) / PHASE_MAX_W, 1) * 100;
          const exporting = w < 0;
          return (
            <div key={i}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted">
                  L{i + 1}
                  {p.voltage != null && (
                    <span className="tabular ml-2 text-subtle">
                      {Math.round(p.voltage)} V{p.current != null && ` · ${p.current} A`}
                    </span>
                  )}
                </span>
                <span className={cn("tabular font-semibold", exporting && "text-export")}>
                  {exporting && "−"}
                  {kw(Math.abs(w))} kW
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted-surface">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-700",
                    exporting ? "bg-export" : "bg-import",
                  )}
                  style={{ width: `${Math.max(pct, w === 0 ? 0 : 1.5)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
