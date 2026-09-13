import type { Reading } from "./api";
import type { MessageKey } from "../locales/en";

export type Unit = "kW" | "A" | "V";
export type MetricGroup = "grid" | "power" | "current" | "voltage";
export type ColorToken = "import" | "export" | "l1" | "l2" | "l3";

export type MetricDef = {
  id: string;
  group: MetricGroup;
  /** Translation key, or a literal label such as "L1". */
  label: MessageKey | string;
  unit: Unit;
  /** Field prefix in series data: `${field}_avg`, `${field}_min`, `${field}_max`. */
  field: string;
  color: ColorToken;
  /** Plot below zero (e.g. export), so import and export read as one net line. */
  negate?: boolean;
  area?: boolean;
};

export const GROUP_LABEL: Record<MetricGroup, MessageKey> = {
  grid: "metrics.group.grid",
  power: "metrics.group.power",
  current: "metrics.group.current",
  voltage: "metrics.group.voltage",
};

const PHASE_COLORS: ColorToken[] = ["l1", "l2", "l3"];

function phaseMetrics(prefix: "p" | "i" | "v", group: MetricGroup, unit: Unit): MetricDef[] {
  return [1, 2, 3].map((ph) => ({
    id: `${prefix}_l${ph}`,
    group,
    label: `L${ph}`,
    unit,
    field: `${prefix}_l${ph}`,
    color: PHASE_COLORS[ph - 1],
  }));
}

/** Everything a P1 meter can show in the measurements chart. */
export const P1_METRICS: MetricDef[] = [
  { id: "grid_import", group: "grid", label: "legend.gridImport", unit: "kW", field: "p_imp", color: "import", area: true },
  { id: "grid_export", group: "grid", label: "legend.gridExport", unit: "kW", field: "p_exp", color: "export", area: true, negate: true },
  ...phaseMetrics("p", "power", "kW"),
  ...phaseMetrics("i", "current", "A"),
  ...phaseMetrics("v", "voltage", "V"),
];

export const DEFAULT_P1_SELECTION = ["grid_import", "grid_export"];

/** How many different units a chart shows at once (one axis each side). */
export const MAX_UNITS = 2;

/**
 * Toggle a metric. When adding it would exceed MAX_UNITS, metrics of the unit that was
 * selected longest ago are removed, so the chart never needs a third axis.
 */
export function toggleMetric(selected: string[], id: string, catalog: MetricDef[]): string[] {
  if (selected.includes(id)) return selected.filter((s) => s !== id);
  const byId = new Map(catalog.map((m) => [m.id, m]));
  let next = [...selected, id];
  const units = [...new Set(next.map((s) => byId.get(s)?.unit))];
  while (units.length > MAX_UNITS) {
    const oldest = units.shift();
    next = next.filter((s) => byId.get(s)?.unit !== oldest);
  }
  return next;
}

/** Convert a live reading into a series point with the given field order. */
export function readingToPoint(reading: Reading, fields: string[]): (number | null)[] {
  const base: Record<string, number | null> = {
    p_imp: reading.power_import,
    p_exp: reading.power_export,
  };
  reading.phases.forEach((phase, i) => {
    base[`p_l${i + 1}`] = phase.power;
    base[`v_l${i + 1}`] = phase.voltage;
    base[`i_l${i + 1}`] = phase.current;
  });
  return fields.map((field) => {
    if (field === "ts") return reading.ts;
    const name = field.replace(/_(avg|min|max)$/, "");
    return base[name] ?? null;
  });
}
