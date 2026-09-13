import type { ChartOption } from "../components/Chart";
import type { Bar, Series } from "./api";
import { energy, euro, num, number, shortDate, time, weekday } from "./format";
import { t, tDynamic } from "./i18n";
import type { MetricDef, Unit } from "./metrics";
import { readTokens } from "./theme";

type Tokens = ReturnType<typeof readTokens>;

function tooltipBase(c: Tokens) {
  return {
    backgroundColor: c.card,
    borderColor: c.border,
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: c.foreground, fontSize: 12, fontFamily: "Inter Variable, sans-serif" },
    extraCssText: "border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);",
  };
}

function axisBase(c: Tokens) {
  return {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: c.subtle, fontSize: 11, fontFamily: "Inter Variable, sans-serif" },
    splitLine: { lineStyle: { color: c.gridLine } },
  };
}

function dot(color: string) {
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:6px"></span>`;
}

type BarRow = { label: string; color: string | null; value: string; strong?: boolean; tone?: string };

function tooltipRows(c: Tokens, head: string, rows: BarRow[]): string {
  const lines = rows.map((r) => {
    const marker = r.color ? dot(r.color) : `<span style="display:inline-block;width:14px"></span>`;
    const value = `<b style="margin-left:auto;padding-left:16px;font-weight:${r.strong ? 650 : 550}${r.tone ? `;color:${r.tone}` : ""}">${r.value}</b>`;
    return `<div style="display:flex;align-items:center;gap:0;line-height:1.7${r.strong ? ";font-weight:600" : ""}">${marker}${r.label}${value}</div>`;
  });
  return `<div style="color:${c.muted};margin-bottom:4px">${head}</div>${lines.join("")}`;
}

/** Rounded end on whichever segment is outermost, so a stack reads as one bar. */
function capped(values: (number | null)[], outer: (i: number) => boolean, radius: number[]) {
  return values.map((v, i) => ({ value: v, itemStyle: outer(i) ? { borderRadius: radius } : undefined }));
}

/**
 * Energy per bucket. Without solar panels: grid import up, export down. With solar:
 * the bar above zero is everything the house used, split into own solar and grid;
 * below zero is what went to the grid.
 */
export function energyBarsOption(
  bars: Bar[],
  label: (ts: number) => string,
  tooltipLabel: (ts: number) => string,
  withSolar: boolean,
): ChartOption {
  const c = readTokens();
  const base = axisBase(c);
  const imp = bars.map((b) => b[1]);
  const exp = bars.map((b) => b[2]);
  const selfUsed = bars.map((b) =>
    b[6] == null ? null : Math.max((b[6] ?? 0) - (b[2] ?? 0), 0),
  );
  const gap = { borderColor: c.card, borderWidth: 1 };

  const series = withSolar
    ? [
        {
          name: t("chart.fromSolar"),
          type: "bar",
          stack: "use",
          barMaxWidth: 28,
          itemStyle: { color: c.solar, ...gap },
          data: capped(selfUsed, (i) => !imp[i], [3, 3, 0, 0]),
        },
        {
          name: t("chart.fromGrid"),
          type: "bar",
          stack: "use",
          barMaxWidth: 28,
          itemStyle: { color: c.grid, ...gap },
          data: capped(imp, () => true, [3, 3, 0, 0]),
        },
        {
          name: t("chart.exported"),
          type: "bar",
          stack: "use",
          barMaxWidth: 28,
          itemStyle: { color: c.export, ...gap },
          data: capped(exp.map((v) => (v == null ? null : -v)), () => true, [0, 0, 3, 3]),
        },
      ]
    : [
        {
          name: t("chart.imported"),
          type: "bar",
          stack: "energy",
          barMaxWidth: 28,
          itemStyle: { color: c.grid, borderRadius: [3, 3, 0, 0], ...gap },
          data: imp,
        },
        {
          name: t("chart.exported"),
          type: "bar",
          stack: "energy",
          barMaxWidth: 28,
          itemStyle: { color: c.export, borderRadius: [0, 0, 3, 3], ...gap },
          data: exp.map((v) => (v == null ? null : -v)),
        },
      ];

  return {
    animationDuration: 300,
    grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipBase(c),
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: `${c.border}66` } },
      formatter: (params: { dataIndex: number }[]) => {
        const b = bars[params[0].dataIndex];
        const kwh = (v: number | null | undefined, digits = 2) => `${energy(v, digits)} kWh`;
        const rows: BarRow[] = [];
        if (withSolar && b[7] != null) {
          rows.push({ label: t("chart.used"), color: null, value: kwh(b[7]), strong: true });
          rows.push({ label: t("chart.fromSolar"), color: c.solar, value: kwh(selfUsed[params[0].dataIndex]) });
          rows.push({ label: t("chart.fromGrid"), color: c.grid, value: kwh(b[1]) });
          if (b[2]) rows.push({ label: t("chart.exported"), color: c.export, value: kwh(b[2]) });
          if (b[6]) rows.push({ label: t("chart.produced"), color: null, value: kwh(b[6]) });
        } else {
          rows.push({ label: t("chart.imported"), color: c.grid, value: kwh(b[1]) });
          if (b[2]) rows.push({ label: t("chart.exported"), color: c.export, value: kwh(b[2]) });
        }
        if (b[3] != null && b[3] > 0) rows.push({ label: t("chart.gas"), color: null, value: `${energy(b[3], 3)} m³` });
        if (b[5]) rows.push({ label: t("chart.feedInCost"), color: null, value: euro(b[5]), tone: c.import });
        if (b[4] != null) rows.push({ label: t("chart.cost"), color: null, value: euro(b[4]) });
        return tooltipRows(c, tooltipLabel(b[0]), rows);
      },
    },
    xAxis: {
      type: "category",
      data: bars.map((b) => label(b[0])),
      ...base,
      splitLine: { show: false },
      axisLabel: { ...base.axisLabel, hideOverlap: true },
    },
    yAxis: {
      type: "value",
      ...base,
      splitNumber: 3,
      axisLabel: { ...base.axisLabel, formatter: (v: number) => `${v < 0 ? "−" : ""}${number(Math.abs(v))}` },
    },
    series,
  };
}

const UNIT_DIGITS: Record<Unit, number> = { kW: 2, A: 1, V: 0 };
const UNIT_SCALE: Record<Unit, number> = { kW: 1000, A: 1, V: 1 };

export function metricLabel(metric: MetricDef): string {
  return metric.label.includes(".") ? tDynamic(metric.label, metric.label) : metric.label;
}

/** Line chart of the selected metrics. Metrics with a different unit get their own panel
 * below the first, sharing the time axis (never two scales on one plot). */
export function metricChartOption(
  data: Series,
  metrics: MetricDef[],
  opts: {
    start: number;
    end: number;
    bucketLabel: "time" | "date" | "datetime";
    showRange: boolean;
  },
): ChartOption {
  const c = readTokens();
  const base = axisBase(c);
  const units = [...new Set(metrics.map((m) => m.unit))];
  const panels = Math.max(units.length, 1);
  const index = new Map(data.fields.map((f, i) => [f, i]));
  const color = (m: MetricDef) => (m.color === "home" ? c.foreground : c[m.color]);
  const format = (unit: Unit, raw: number | null | undefined) =>
    raw == null ? "—" : num(raw / UNIT_SCALE[unit], UNIT_DIGITS[unit]);
  const hasHome = metrics.some((m) => m.id === "home");
  const dark = document.documentElement.classList.contains("dark");

  const area = (hex: string, strength: string) => ({
    color: {
      type: "linear",
      x: 0,
      y: 0,
      x2: 0,
      y2: 1,
      colorStops: [
        { offset: 0, color: `${hex}${strength}` },
        { offset: 1, color: `${hex}08` },
      ],
    },
  });

  const series = metrics.map((m) => {
    const avg = index.get(`${m.field}_avg`);
    const sign = m.negate ? -1 : 1;
    const panel = units.indexOf(m.unit);
    const hasVoltageLimits = m.unit === "V" && metrics.find((x) => x.unit === "V") === m;
    // With home consumption on screen, grid import is read against it as a line.
    const filled = m.area && (m.id !== "grid_import" || !hasHome);
    return {
      id: m.id,
      name: metricLabel(m),
      type: "line",
      xAxisIndex: panel,
      yAxisIndex: panel,
      showSymbol: false,
      smooth: m.unit === "kW" ? 0.2 : 0,
      sampling: "lttb",
      z: m.emphasis ? 5 : m.area ? 2 : 3,
      lineStyle: { width: m.emphasis ? 2.25 : 1.6, color: color(m) },
      itemStyle: { color: color(m) },
      ...(filled ? { areaStyle: area(color(m), m.id === "solar" ? (dark ? "40" : "59") : "38") } : {}),
      data: data.points.map((p) => {
        const v = avg == null ? null : p[avg];
        return [(p[0] as number) * 1000, v == null ? null : (sign * v) / UNIT_SCALE[m.unit]];
      }),
      ...(hasVoltageLimits
        ? {
            markLine: {
              silent: true,
              symbol: "none",
              label: { color: c.subtle, fontSize: 10, formatter: "{c} V", position: "insideEndTop" },
              lineStyle: { color: c.subtle, type: "dashed", width: 1 },
              data: [{ yAxis: 207 }, { yAxis: 253 }],
            },
          }
        : {}),
    };
  });

  // One panel per unit, stacked, leaving room for the navigator at the bottom.
  const grids =
    panels === 1
      ? [{ left: 8, right: 16, top: 24, bottom: 44, containLabel: true }]
      : [
          { left: 8, right: 16, top: 24, bottom: "54%", containLabel: true },
          { left: 8, right: 16, top: "53%", bottom: 44, containLabel: true },
        ];

  const yAxis = (units.length ? units : (["kW"] as Unit[])).map((unit, i) => ({
    type: "value",
    gridIndex: i,
    ...base,
    splitNumber: panels > 1 ? 2 : 4,
    name: unit,
    nameGap: 10,
    nameTextStyle: { color: c.subtle, fontSize: 11, align: "right", padding: [0, 6, 0, 0] },
    ...(unit === "V"
      ? {
          // Whole 5 V steps around the 207–253 V limits, so ticks don't crowd each other.
          min: (e: { min: number }) => Math.min(Math.floor((e.min - 2) / 5) * 5, 205),
          max: (e: { max: number }) => Math.max(Math.ceil((e.max + 2) / 5) * 5, 255),
          ...(panels > 1 ? { interval: 25 } : {}),
        }
      : {}),
    axisLabel: {
      ...base.axisLabel,
      formatter: (v: number) => `${v < 0 ? "−" : ""}${num(Math.abs(v), unit === "kW" && Math.abs(v) < 10 && v % 1 ? 1 : 0)}`,
    },
  }));

  const timeLabel = (ts: number) =>
    opts.bucketLabel === "time"
      ? time(ts)
      : opts.bucketLabel === "date"
        ? shortDate(ts)
        : `${weekday(ts)} ${time(ts)}`;

  const xAxis = grids.map((_, i) => ({
    type: "time",
    gridIndex: i,
    min: opts.start * 1000,
    max: opts.end * 1000,
    ...base,
    splitLine: { show: false },
    axisLine: { show: true, lineStyle: { color: c.border } },
    axisLabel: {
      ...base.axisLabel,
      show: i === grids.length - 1,
      hideOverlap: true,
      formatter: (v: number) => timeLabel(v / 1000),
    },
  }));

  // Zero line for power charts, so above/below zero (import/export) reads instantly.
  const zeroPanel = units.indexOf("kW");
  if (zeroPanel >= 0 && series.length) {
    const first = series.find((s) => s.yAxisIndex === zeroPanel)!;
    Object.assign(first, {
      markLine: {
        silent: true,
        symbol: "none",
        label: { show: false },
        lineStyle: { color: c.muted, width: 1, opacity: 0.5, type: "solid" },
        data: [{ yAxis: 0 }],
      },
    });
  }

  return {
    animation: false,
    grid: grids,
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    tooltip: {
      ...tooltipBase(c),
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: c.muted, opacity: 0.5 } },
      formatter: (params: { dataIndex: number }[]) => {
        if (!params.length) return "";
        const point = data.points[params[0].dataIndex];
        if (!point) return "";
        const ts = point[0] as number;
        const head =
          opts.bucketLabel === "time" ? time(ts, data.bucket_seconds < 60) : `${weekday(ts)} ${shortDate(ts)}, ${time(ts)}`;
        const rows = metrics.map((m) => {
          const at = (suffix: string) => {
            const i = index.get(`${m.field}_${suffix}`);
            return i == null ? null : point[i];
          };
          const avg = at("avg");
          if (avg == null) return null;
          const min = at("min");
          const max = at("max");
          const range =
            opts.showRange && max != null && max !== avg
              ? `<span style="color:${c.muted};margin-left:6px;font-weight:400">${
                  min != null
                    ? t("phases.minMax", { min: format(m.unit, min), max: format(m.unit, max) })
                    : t("phases.max", { max: format(m.unit, max) })
                }</span>`
              : "";
          return {
            label: metricLabel(m),
            color: color(m),
            value: `${format(m.unit, avg)} ${m.unit}${range}`,
            strong: m.emphasis,
          };
        });
        return tooltipRows(c, head, rows.filter((r): r is NonNullable<typeof r> => r != null));
      },
    },
    xAxis,
    yAxis,
    // Navigator below the plot: drag its handles or the selected window to zoom and pan.
    // Works with mouse and touch, and always shows where the view is. Zoom state is
    // deliberately not part of this option, so data updates don't reset it.
    dataZoom: [
      {
        type: "slider",
        xAxisIndex: xAxis.map((_, i) => i),
        // Rescale the y-axes to what is visible, keeping lines connected at the edges.
        filterMode: "weakFilter",
        minValueSpan: Math.max(data.bucket_seconds * 12, 60) * 1000,
        height: 22,
        bottom: 6,
        left: 16,
        right: 16,
        showDetail: false,
        brushSelect: false,
        borderColor: c.border,
        borderRadius: 6,
        backgroundColor: "transparent",
        fillerColor: `${c.foreground}10`,
        dataBackground: {
          lineStyle: { color: c.subtle, opacity: 0.6, width: 1 },
          areaStyle: { color: c.subtle, opacity: 0.08 },
        },
        selectedDataBackground: {
          lineStyle: { color: c.muted, width: 1 },
          areaStyle: { color: c.muted, opacity: 0.15 },
        },
        handleIcon: "path://M-3,-9h6v18h-6z",
        handleSize: "90%",
        handleStyle: { color: c.card, borderColor: c.muted, borderWidth: 1 },
        moveHandleSize: 0,
        emphasis: { handleStyle: { borderColor: c.foreground } },
      },
    ],
    series,
  };
}
