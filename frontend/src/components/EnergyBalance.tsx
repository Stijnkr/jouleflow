import type { ReactNode } from "react";
import { euro } from "../lib/format";
import { t } from "../lib/i18n";
import { formatFlow, ratios, type FlowValues } from "./EnergyFlow";
import { cn } from "./ui";

type Props = {
  flow: FlowValues | null;
  hasSolar: boolean;
  cost?: number | null;
  costNote?: ReactNode;
};

/** Key figures for a period: grid balance, self-sufficiency, self-consumption and cost. */
export function EnergyBalance({ flow, hasSolar, cost, costNote }: Props) {
  const { selfSufficiency, selfConsumption } = ratios(flow);
  return (
    <div className="flex flex-col divide-y divide-border">
      <GridBalance flow={flow} />
      {hasSolar && (
        <div className="grid grid-cols-2 gap-4 py-5">
          <Meter
            value={selfSufficiency}
            color="var(--solar)"
            label={t("balance.selfSufficiency")}
            hint={t("balance.selfSufficiencyHint")}
          />
          <Meter
            value={selfConsumption}
            color="var(--foreground)"
            label={t("balance.selfConsumption")}
            hint={t("balance.selfConsumptionHint")}
          />
        </div>
      )}
      {cost != null && (
        <div className="py-5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-medium text-muted">{t("today.cost")}</h3>
            <span className="tabular text-[28px] leading-none font-semibold tracking-tight">{euro(cost)}</span>
          </div>
          {costNote && <div className="tabular mt-2 text-[13px] leading-relaxed text-muted">{costNote}</div>}
        </div>
      )}
    </div>
  );
}

/** Import against export around zero; the net result is what the meter adds up to. */
function GridBalance({ flow }: { flow: FlowValues | null }) {
  const imp = flow?.imp ?? 0;
  const exp = flow?.exp ?? 0;
  const net = imp - exp;
  const scale = Math.max(imp, exp, 0.001);
  return (
    <div className="pb-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-muted">{t("balance.title")}</h3>
        <span className="tabular text-[28px] leading-none font-semibold tracking-tight">
          {flow ? formatFlow(Math.abs(net), "kWh") : "—"}
        </span>
      </div>
      <p className="tabular mt-1.5 text-right text-[13px] text-muted">
        {flow ? t(net >= 0 ? "balance.netImport" : "balance.netExport") : " "}
      </p>
      <div className="relative mt-3 grid h-3 grid-cols-2 gap-px">
        <div className="flex justify-end overflow-hidden rounded-l-full bg-muted-surface">
          <div
            className="h-full rounded-l-full bg-export transition-[width] duration-700"
            style={{ width: `${(exp / scale) * 100}%` }}
          />
        </div>
        <div className="overflow-hidden rounded-r-full bg-muted-surface">
          <div
            className="h-full rounded-r-full bg-grid transition-[width] duration-700"
            style={{ width: `${(imp / scale) * 100}%` }}
          />
        </div>
        <span className="absolute -top-1 -bottom-1 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-foreground" />
      </div>
      <div className="tabular mt-2.5 grid grid-cols-2 gap-3 text-[13px]">
        <div>
          <div className="flex items-center gap-1.5 text-muted">
            <span className="size-2.5 rounded-sm bg-export" />
            {t("today.exported")}
          </div>
          <div className="mt-0.5 font-semibold">{flow ? formatFlow(exp, "kWh") : "—"}</div>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-1.5 text-muted">
            {t("today.imported")}
            <span className="size-2.5 rounded-sm bg-grid" />
          </div>
          <div className="mt-0.5 font-semibold">{flow ? formatFlow(imp, "kWh") : "—"}</div>
        </div>
      </div>
    </div>
  );
}

const ARC = Math.PI * 44;

/** Half-circle meter for a share between 0 and 100%. */
function Meter({
  value,
  color,
  label,
  hint,
}: {
  value: number | null;
  color: string;
  label: string;
  hint: string;
}) {
  const pct = value == null ? null : Math.round(value * 100);
  return (
    <figure className="flex flex-col items-center text-center" title={hint}>
      <svg viewBox="0 0 110 62" className="w-full max-w-[150px] px-1" aria-hidden>
        <path d="M11,55 A44,44 0 0 1 99,55" fill="none" stroke="var(--muted-surface)" strokeWidth="8" strokeLinecap="round" />
        {pct != null && pct > 0 && (
          <path
            d="M11,55 A44,44 0 0 1 99,55"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * ARC} ${ARC}`}
            className="transition-[stroke-dasharray] duration-700"
          />
        )}
      </svg>
      <div className={cn("tabular -mt-7 text-[22px] leading-none font-semibold tracking-tight", pct == null && "text-subtle")}>
        {pct == null ? "—" : `${pct}%`}
      </div>
      <figcaption className="mt-3 text-[13px] font-medium">{label}</figcaption>
      <p className="mt-0.5 text-xs leading-snug text-muted">{hint}</p>
    </figure>
  );
}
