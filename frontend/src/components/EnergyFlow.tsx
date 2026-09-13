import { Home, Sun, UtilityPole } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { powerText } from "../lib/format";
import { t } from "../lib/i18n";
import { cn } from "./ui";

/** Power flowing between the panels, the grid and the house, split the way it physically
 * goes: solar feeds the house first, the rest goes to the grid; the grid covers the gap. */
export function splitFlow(netW: number, solarW: number) {
  const exportW = Math.max(-netW, 0);
  const importW = Math.max(netW, 0);
  const homeW = Math.max(netW + solarW, 0);
  const solarToHome = Math.max(Math.min(solarW - exportW, homeW), 0);
  return { homeW, importW, exportW, solarToHome };
}

const ACTIVE_W = 5;
const MAX_W = 6000;

/** Stroke width grows with power (square root, so small flows stay visible). */
const width = (w: number) => 1.5 + 5.5 * Math.sqrt(Math.min(w, MAX_W) / MAX_W);

type Props = {
  netW: number | null;
  solarW: number;
  hasSolar: boolean;
  children?: ReactNode;
};

export function EnergyFlow({ netW, solarW, hasSolar, children }: Props) {
  const flow = netW == null ? null : splitFlow(netW, hasSolar ? solarW : 0);
  const text = (w: number) => powerText(w);

  let sentence = t("flow.waiting");
  if (flow) {
    if (hasSolar && flow.exportW >= ACTIVE_W) {
      sentence = t("flow.sentenceExport", {
        solar: text(solarW),
        home: text(flow.homeW),
        export: text(flow.exportW),
      });
    } else if (hasSolar && flow.solarToHome >= ACTIVE_W && flow.importW >= ACTIVE_W) {
      sentence = t("flow.sentenceMixed", {
        home: text(flow.homeW),
        solar: text(flow.solarToHome),
        grid: text(flow.importW),
      });
    } else if (hasSolar && flow.solarToHome >= ACTIVE_W) {
      sentence = t("flow.sentenceSolarOnly", { home: text(flow.homeW) });
    } else if (flow.exportW >= ACTIVE_W) {
      sentence = t("flow.sentenceExportNoSolar", { export: text(flow.exportW) });
    } else {
      sentence = t("flow.sentenceGrid", { home: text(flow.homeW) });
    }
  }

  return (
    <div>
      <p className="max-w-[46ch] text-xl leading-snug font-medium tracking-tight text-balance sm:text-2xl">
        {sentence}
      </p>
      {hasSolar ? <Triangle flow={flow} solarW={solarW} /> : <Pair flow={flow} />}
      {children}
    </div>
  );
}

type Flow = ReturnType<typeof splitFlow> | null;

function Connector({
  d,
  w,
  color,
  reverse = false,
}: {
  d: string;
  w: number;
  color: string;
  reverse?: boolean;
}) {
  const active = w >= ACTIVE_W;
  return (
    <>
      <path
        d={d}
        fill="none"
        stroke="var(--border)"
        strokeWidth={active ? width(w) + 2 : 1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
      />
      {active && (
        <>
          <path
            d={d}
            fill="none"
            stroke={color}
            strokeOpacity={0.28}
            strokeWidth={width(w)}
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
          />
          <path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={width(w) + 1.5}
            vectorEffect="non-scaling-stroke"
            className={cn("flow-dots", reverse && "reverse")}
          />
        </>
      )}
    </>
  );
}

function Node({
  x,
  y,
  icon,
  label,
  value,
  tone,
  active,
  labelSide,
  size = "md",
}: {
  x: number;
  y: number;
  icon: ReactNode;
  label: string;
  value: string;
  tone: string;
  active: boolean;
  labelSide: "top" | "bottom";
  size?: "md" | "lg";
}) {
  return (
    <div
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div
        className={cn(
          "relative grid place-items-center rounded-full border-2 bg-card transition-colors",
          size === "lg" ? "size-[72px] sm:size-[88px]" : "size-14 sm:size-[68px]",
        )}
        style={{ borderColor: active ? tone : "var(--border)", color: active ? tone : "var(--subtle)" }}
      >
        {icon}
      </div>
      <div
        className={cn(
          "absolute left-1/2 w-max -translate-x-1/2 text-center",
          labelSide === "top" ? "bottom-full mb-2" : "top-full mt-2",
        )}
      >
        <div className="text-[13px] text-muted">{label}</div>
        <div className="tabular text-lg leading-tight font-semibold tracking-tight sm:text-xl">{value}</div>
      </div>
    </div>
  );
}

/** Solar, grid and house: three nodes with the three flows between them. */
function Triangle({ flow, solarW }: { flow: Flow; solarW: number }) {
  const S = { x: 16, y: 27 };
  const G = { x: 16, y: 73 };
  const H = { x: 80, y: 50 };
  const curve = (a: { x: number; y: number }) =>
    `M${a.x},${a.y} C${a.x + 26},${a.y} ${H.x - 30},${H.y} ${H.x},${H.y}`;
  const f = flow ?? { homeW: 0, importW: 0, exportW: 0, solarToHome: 0 };

  return (
    <div
      role="img"
      aria-label={t("flow.label")}
      className="relative mt-6 h-[330px] w-full sm:h-[360px]"
    >
      <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Connector d={curve(S)} w={f.solarToHome} color="var(--solar)" />
        <Connector d={curve(G)} w={f.importW} color="var(--grid)" />
        <Connector d={`M${S.x},${S.y} L${G.x},${G.y}`} w={f.exportW} color="var(--export)" />
      </svg>
      <FlowLabel x={47} y={33} w={f.solarToHome} />
      <FlowLabel x={47} y={67} w={f.importW} />
      <FlowLabel x={S.x + 3} y={50} w={f.exportW} align="left" />
      <Node
        {...S}
        icon={<Sun className="size-6 sm:size-7" strokeWidth={1.75} />}
        label={t("flow.solar")}
        value={flow ? powerText(solarW) : "—"}
        tone="var(--solar)"
        active={solarW >= ACTIVE_W}
        labelSide="top"
      />
      <Node
        {...G}
        icon={<UtilityPole className="size-6 sm:size-7" strokeWidth={1.75} />}
        label={t("flow.grid")}
        value={flow ? powerText(f.importW || f.exportW) : "—"}
        tone={f.exportW >= ACTIVE_W ? "var(--export)" : "var(--grid)"}
        active={f.importW >= ACTIVE_W || f.exportW >= ACTIVE_W}
        labelSide="bottom"
      />
      <Node
        {...H}
        icon={<Home className="size-7 sm:size-8" strokeWidth={1.75} />}
        label={t("flow.home")}
        value={flow ? powerText(f.homeW) : "—"}
        tone="var(--foreground)"
        active={f.homeW >= ACTIVE_W}
        labelSide="bottom"
        size="lg"
      />
    </div>
  );
}

/** Without solar panels: grid and house side by side. */
function Pair({ flow }: { flow: Flow }) {
  const f = flow ?? { homeW: 0, importW: 0, exportW: 0, solarToHome: 0 };
  const exporting = f.exportW >= ACTIVE_W;
  return (
    <div className="relative mx-auto mt-6 h-[220px] w-full max-w-[560px]">
      <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Connector
          d="M20,45 L80,45"
          w={exporting ? f.exportW : f.importW}
          color={exporting ? "var(--export)" : "var(--grid)"}
          reverse={exporting}
        />
      </svg>
      <FlowLabel x={50} y={30} w={exporting ? f.exportW : f.importW} />
      <Node
        x={20}
        y={45}
        icon={<UtilityPole className="size-7" strokeWidth={1.75} />}
        label={t("flow.grid")}
        value={flow ? powerText(f.importW || f.exportW) : "—"}
        tone={exporting ? "var(--export)" : "var(--grid)"}
        active={f.importW >= ACTIVE_W || exporting}
        labelSide="bottom"
      />
      <Node
        x={80}
        y={45}
        icon={<Home className="size-8" strokeWidth={1.75} />}
        label={t("flow.home")}
        value={flow ? powerText(f.homeW) : "—"}
        tone="var(--foreground)"
        active={f.homeW >= ACTIVE_W}
        labelSide="bottom"
        size="lg"
      />
      <Link
        to="/settings/solar"
        className="absolute top-full left-1/2 -translate-x-1/2 -translate-y-6 rounded-full border border-dashed border-border px-3 py-1.5 text-sm whitespace-nowrap text-muted hover:text-foreground"
      >
        {t("flow.connectSolar")}
      </Link>
    </div>
  );
}

function FlowLabel({ x, y, w, align = "center" }: { x: number; y: number; w: number; align?: "center" | "left" }) {
  if (w < ACTIVE_W) return null;
  return (
    <span
      className={cn(
        "tabular absolute -translate-y-1/2 rounded-full bg-card px-2 py-0.5 text-xs font-medium whitespace-nowrap text-muted",
        align === "center" && "-translate-x-1/2",
      )}
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      {powerText(w)}
    </span>
  );
}
