import type { Reading } from "./api";
import type { MessageKey } from "../locales/en";

export type Unit = "kW" | "A" | "V";
export type MetricGroup = "home" | "power" | "current" | "voltage";
export type ColorToken = "home" | "solar" | "grid" | "export" | "l1" | "l2" | "l3";

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
  /** Thicker line for the series the chart is about. */
  emphasis?: boolean;
};

export const GROUP_LABEL: Record<MetricGroup, MessageKey> = {
  home: "metrics.group.home",
  power: "metrics.group.power",
  current: "metrics.group.current",
  voltage: "metrics.group.voltage",
};

/** Groups for the few people who want the electrical detail; folded away by default. */
export const DETAIL_GROUPS: MetricGroup[] = ["power", "current", "voltage"];

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

/** Everything the measurements chart can show. Home and solar need connected panels. */
export const P1_METRICS: MetricDef[] = [
  { id: "home", group: "home", label: "legend.home", unit: "kW", field: "home", color: "home", emphasis: true },
  { id: "solar", group: "home", label: "legend.solar", unit: "kW", field: "solar", color: "solar", area: true },
  { id: "grid_import", group: "home", label: "legend.gridImport", unit: "kW", field: "p_imp", color: "grid", area: true },
  { id: "grid_export", group: "home", label: "legend.gridExport", unit: "kW", field: "p_exp", color: "export", area: true, negate: true },
  ...phaseMetrics("p", "power", "kW"),
  ...phaseMetrics("i", "current", "A"),
  ...phaseMetrics("v", "voltage", "V"),
];

export const DEFAULT_P1_SELECTION = ["home", "solar", "grid_import", "grid_export"];

/** Metrics the data can actually provide (home and solar only exist with solar panels). */
export function availableMetrics(catalog: MetricDef[], fields: string[] | undefined): MetricDef[] {
  if (!fields) return catalog.filter((m) => m.field !== "home" && m.field !== "solar");
  return catalog.filter((m) => fields.includes(`${m.field}_avg`));
}

/** How many different units a chart shows at once (one panel each). */
export const MAX_UNITS = 2;

/**
 * Toggle a metric. When adding it would exceed MAX_UNITS, metrics of the unit that was
 * selected longest ago are removed, so the chart never needs a third panel.
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

/** Convert a live reading into a series point with the given field order. Solar values
 * are carried over from the previous point, since they update less often than the meter. */
export function readingToPoint(
  reading: Reading,
  fields: string[],
  previous?: (number | null)[],
  solarW?: number | null,
): (number | null)[] {
  const base: Record<string, number | null> = {
    p_imp: reading.power_import,
    p_exp: reading.power_export,
  };
  reading.phases.forEach((phase, i) => {
    base[`p_l${i + 1}`] = phase.power;
    base[`v_l${i + 1}`] = phase.voltage;
    base[`i_l${i + 1}`] = phase.current;
  });
  const solarIndex = fields.indexOf("solar_avg");
  if (solarIndex >= 0) {
    const solar = solarW ?? previous?.[solarIndex] ?? null;
    base.solar = solar;
    base.home = solar == null ? null : Math.max(reading.power_net + solar, 0);
  }
  return fields.map((field) => {
    if (field === "ts") return reading.ts;
    const name = field.replace(/_(avg|min|max)$/, "");
    return base[name] ?? null;
  });
}
