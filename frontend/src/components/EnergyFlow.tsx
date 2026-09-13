import { ArrowLeft, ArrowRight, Home, Sun, UtilityPole } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { energy, powerText } from "../lib/format";
import { t } from "../lib/i18n";

/** How energy moved between the panels, the grid and the house, split the way it
 * physically goes: solar feeds the house first, the rest goes to the grid, and the grid
 * covers what is left. Works for power (W, now) and energy (kWh, over a period). */
export type FlowValues = {
  solar: number;
  imp: number;
  exp: number;
  home: number;
  solarToHome: number;
};

export function powerFlow(netW: number, solarW: number): FlowValues {
  const exp = Math.max(-netW, 0);
  const imp = Math.max(netW, 0);
  const home = Math.max(netW + solarW, 0);
  return { solar: solarW, imp, exp, home, solarToHome: Math.max(Math.min(solarW - exp, home), 0) };
}

export function energyFlow(e: {
  import?: number | null;
  export?: number | null;
  solar?: number | null;
  consumption?: number | null;
}): FlowValues | null {
  if (e.import == null) return null;
  const solar = e.solar ?? 0;
  const exp = e.export ?? 0;
  return {
    solar,
    imp: e.import,
    exp,
    home: e.consumption ?? Math.max(e.import - exp + solar, 0),
    solarToHome: Math.max(solar - exp, 0),
  };
}

export type FlowUnit = "W" | "kWh";

export const formatFlow = (v: number, unit: FlowUnit) =>
  unit === "W" ? powerText(v) : `${energy(v, v >= 100 ? 0 : v >= 10 ? 1 : 2)} kWh`;

/** Below this a flow counts as nothing (standby noise, rounding). */
const threshold = (unit: FlowUnit) => (unit === "W" ? 5 : 0.005);

/** Shares of what the house used and of what the panels produced. */
export function ratios(v: FlowValues | null) {
  if (!v) return { selfSufficiency: null, selfConsumption: null };
  return {
    selfSufficiency: v.home > 0 ? Math.min(v.solarToHome / v.home, 1) : null,
    selfConsumption: v.solar > 0 ? Math.min(v.solarToHome / v.solar, 1) : null,
  };
}

export function flowSentence(v: FlowValues | null, unit: FlowUnit, hasSolar: boolean): string {
  if (!v) return t(unit === "W" ? "flow.waiting" : "flow.noData");
  const min = threshold(unit);
  const f = (x: number) => formatFlow(x, unit);
  if (unit === "kWh") {
    const { selfSufficiency } = ratios(v);
    if (hasSolar && selfSufficiency != null && v.solarToHome >= min) {
      return t("flow.periodSolar", { home: f(v.home), pct: Math.round(selfSufficiency * 100) });
    }
    return t("flow.periodGrid", { home: f(v.home) });
  }
  if (hasSolar && v.exp >= min) {
    return t("flow.sentenceExport", { solar: f(v.solar), home: f(v.home), export: f(v.exp) });
  }
  if (hasSolar && v.solarToHome >= min && v.imp >= min) {
    return t("flow.sentenceMixed", { home: f(v.home), solar: f(v.solarToHome), grid: f(v.imp) });
  }
  if (hasSolar && v.solarToHome >= min) return t("flow.sentenceSolarOnly", { home: f(v.home) });
  if (v.exp >= min) return t("flow.sentenceExportNoSolar", { export: f(v.exp) });
  return t("flow.sentenceGrid", { home: f(v.home) });
}

type Props = {
  values: FlowValues | null;
  unit: FlowUnit;
  hasSolar: boolean;
  /** Animate the flows (live power); energy over a period is drawn still. */
  animate: boolean;
};

// Node centres in % of the diagram: solar on top, grid left, home right.
const S = { x: 50, y: 24 };
const G = { x: 15, y: 70 };
const H = { x: 85, y: 70 };

export function EnergyFlow({ values, unit, hasSolar, animate }: Props) {
  const v = values ?? { solar: 0, imp: 0, exp: 0, home: 0, solarToHome: 0 };
  const min = threshold(unit);
  const biggest = Math.max(v.solar, v.imp, v.exp, v.home, min);
  // Line width follows the flow: absolute for power, relative to the largest for energy.
  const width = (x: number) =>
    unit === "W" ? 1.5 + 5.5 * Math.sqrt(Math.min(x, 6000) / 6000) : 1.5 + 5 * Math.sqrt(x / biggest);

  const solarShare = v.home > 0 ? Math.min(v.solarToHome / v.home, 1) : 0;
  const exportShare = v.imp + v.exp > 0 ? v.exp / (v.imp + v.exp) : 0;

  return (
    <div role="img" aria-label={t("flow.label")} className="relative h-[300px] w-full sm:h-[340px]">
      <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Connector
          d={`M${G.x},${G.y + 5} L${H.x},${H.y + 5}`}
          active={v.imp >= min}
          width={width(v.imp)}
          color="var(--grid)"
          animate={animate}
        />
        {hasSolar && (
          <>
            <Connector
              d={`M${S.x + 1.5},${S.y} C${S.x + 1.5},${H.y - 4} ${S.x + 12},${H.y - 4} ${H.x},${H.y - 4}`}
              active={v.solarToHome >= min}
              width={width(v.solarToHome)}
              color="var(--solar)"
              animate={animate}
            />
            <Connector
              d={`M${S.x - 1.5},${S.y} C${S.x - 1.5},${G.y - 4} ${S.x - 12},${G.y - 4} ${G.x},${G.y - 4}`}
              active={v.exp >= min}
              width={width(v.exp)}
              color="var(--export)"
              animate={animate}
            />
          </>
        )}
      </svg>

      <FlowChip x={50} y={G.y + 5} value={v.imp} unit={unit} show={values != null && v.imp >= min} />
      {hasSolar && (
        <>
          <FlowChip x={65} y={H.y - 4} value={v.solarToHome} unit={unit} show={values != null && v.solarToHome >= min} />
          <FlowChip x={35} y={G.y - 4} value={v.exp} unit={unit} show={values != null && v.exp >= min} />
        </>
      )}

      {hasSolar ? (
        <Node
          at={S}
          labelAbove
          label={t("flow.solar")}
          ring={[{ share: 1, color: v.solar >= min ? "var(--solar)" : "var(--border)" }]}
        >
          <Sun className="size-5 text-solar sm:size-6" strokeWidth={1.75} />
          <NodeValue>{values ? formatFlow(v.solar, unit) : "—"}</NodeValue>
        </Node>
      ) : (
        <Link
          to="/settings/solar"
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-border bg-card px-3 py-1.5 text-sm whitespace-nowrap text-muted hover:text-foreground"
          style={{ left: `${S.x}%`, top: `${S.y}%` }}
        >
          {t("flow.connectSolar")}
        </Link>
      )}

      <Node
        at={G}
        label={t("flow.grid")}
        ring={
          v.imp + v.exp >= min
            ? [
                { share: exportShare, color: "var(--export)" },
                { share: 1 - exportShare, color: "var(--grid)" },
              ]
            : [{ share: 1, color: "var(--border)" }]
        }
      >
        <UtilityPole className="size-5 text-grid sm:size-6" strokeWidth={1.75} />
        {values ? (
          <div className="tabular flex flex-col items-center text-[11px] leading-tight font-semibold whitespace-nowrap sm:text-xs">
            {(unit === "kWh" || v.imp >= min || v.exp < min) && (
              <span className="flex items-center gap-0.5 text-grid" title={t("chart.fromGrid")}>
                <ArrowRight className="size-3" strokeWidth={2.5} />
                {formatFlow(v.imp, unit)}
              </span>
            )}
            {v.exp >= min && (
              <span className="flex items-center gap-0.5 text-export" title={t("chart.exported")}>
                <ArrowLeft className="size-3" strokeWidth={2.5} />
                {formatFlow(v.exp, unit)}
              </span>
            )}
          </div>
        ) : (
          <NodeValue>—</NodeValue>
        )}
      </Node>

      <Node
        at={H}
        label={t("flow.home")}
        ring={
          v.home >= min
            ? [
                { share: solarShare, color: "var(--solar)" },
                { share: 1 - solarShare, color: "var(--grid)" },
              ]
            : [{ share: 1, color: "var(--border)" }]
        }
      >
        <Home className="size-5 text-foreground sm:size-6" strokeWidth={1.75} />
        <NodeValue>{values ? formatFlow(v.home, unit) : "—"}</NodeValue>
      </Node>
    </div>
  );
}

function Connector({
  d,
  active,
  width,
  color,
  animate,
}: {
  d: string;
  active: boolean;
  width: number;
  color: string;
  animate: boolean;
}) {
  if (!active) {
    return <path d={d} fill="none" stroke="var(--border)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />;
  }
  return (
    <>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeOpacity={animate ? 0.3 : 0.9}
        strokeWidth={width}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {animate && (
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={width + 1.5}
          vectorEffect="non-scaling-stroke"
          className="flow-dots"
        />
      )}
    </>
  );
}

/** A round node with a segmented ring showing what its total is made of. */
function Node({
  at,
  label,
  labelAbove = false,
  ring,
  children,
}: {
  at: { x: number; y: number };
  label: string;
  labelAbove?: boolean;
  ring: { share: number; color: string }[];
  children: ReactNode;
}) {
  const r = 46;
  const circumference = 2 * Math.PI * r;
  const segments = ring.filter((seg) => seg.share > 0.001);
  const starts = segments.map((_, i) => segments.slice(0, i).reduce((sum, s) => sum + s.share, 0));
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${at.x}%`, top: `${at.y}%` }}
    >
      <div className="relative size-[84px] sm:size-[104px]">
        <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90">
          <circle cx="50" cy="50" r={r} className="fill-card" />
          {segments.map((seg, i) => {
            const length = seg.share * circumference;
            return (
              <circle
                key={i}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth="4"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-starts[i] * circumference}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-1">{children}</div>
      </div>
      <div
        className={
          labelAbove
            ? "absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 text-[13px] whitespace-nowrap text-muted"
            : "absolute top-full left-1/2 mt-1.5 -translate-x-1/2 text-[13px] whitespace-nowrap text-muted"
        }
      >
        {label}
      </div>
    </div>
  );
}

function NodeValue({ children }: { children: ReactNode }) {
  return <div className="tabular text-xs leading-tight font-semibold whitespace-nowrap sm:text-sm">{children}</div>;
}

function FlowChip({
  x,
  y,
  value,
  unit,
  show,
}: {
  x: number;
  y: number;
  value: number;
  unit: FlowUnit;
  show: boolean;
}) {
  if (!show) return null;
  return (
    <span
      className="tabular absolute hidden -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] sm:block font-medium whitespace-nowrap text-muted"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      {formatFlow(value, unit)}
    </span>
  );
}
