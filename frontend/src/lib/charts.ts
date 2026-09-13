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

/** Energy bars per bucket: import up, export down. */
export function energyBarsOption(
  bars: Bar[],
  label: (ts: number) => string,
  tooltipLabel: (ts: number) => string,
): ChartOption {
  const c = readTokens();
  const base = axisBase(c);
  return {
    animationDuration: 300,
    grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipBase(c),
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: `${c.border}66` } },
      formatter: (params: { dataIndex: number }[]) => {
        const b = bars[params[0].dataIndex];
        const rows = [`${dot(c.import)}${t("chart.imported")} <b style="margin-left:8px">${energy(b[1])} kWh</b>`];
        if (b[2]) rows.push(`${dot(c.export)}${t("chart.exported")} <b style="margin-left:8px">${energy(b[2])} kWh</b>`);
        if (b[3] != null) rows.push(`${dot(c.gas)}${t("chart.gas")} <b style="margin-left:8px">${energy(b[3], 3)} m³</b>`);
        if (b[4] != null)
          rows.push(`<span style="display:inline-block;width:14px"></span>${t("chart.cost")} <b style="margin-left:8px">${euro(b[4])}</b>`);
        return `<div style="color:${c.muted};margin-bottom:4px">${tooltipLabel(b[0])}</div>${rows.join("<br/>")}`;
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
    series: [
      {
        name: t("chart.imported"),
        type: "bar",
        stack: "energy",
        barMaxWidth: 28,
        itemStyle: { color: c.import, borderRadius: [3, 3, 0, 0] },
        data: bars.map((b) => b[1]),
      },
      {
        name: t("chart.exported"),
        type: "bar",
        stack: "energy",
        barMaxWidth: 28,
        itemStyle: { color: c.export, borderRadius: [0, 0, 3, 3] },
        data: bars.map((b) => (b[2] == null ? null : -b[2])),
      },
    ],
  };
}


const UNIT_DIGITS: Record<Unit, number> = { kW: 2, A: 1, V: 0 };
const UNIT_SCALE: Record<Unit, number> = { kW: 1000, A: 1, V: 1 };

export function metricLabel(metric: MetricDef): string {
  return metric.label.includes(".") ? tDynamic(metric.label, metric.label) : metric.label;
}

/** Line chart of the selected metrics, with one y-axis per unit (at most two). */
export function metricChartOption(
  data: Series,
  metrics: MetricDef[],
  opts: { start: number; end: number; bucketLabel: "time" | "date" | "datetime"; showRange: boolean },
): ChartOption {
  const c = readTokens();
  const base = axisBase(c);
  const units = [...new Set(metrics.map((m) => m.unit))];
  const index = new Map(data.fields.map((f, i) => [f, i]));
  const color = (m: MetricDef) => c[m.color];
  const format = (unit: Unit, raw: number | null | undefined) =>
    raw == null ? "—" : num(raw / UNIT_SCALE[unit], UNIT_DIGITS[unit]);

  const area = (hex: string) => ({
    color: {
      type: "linear",
      x: 0,
      y: 0,
      x2: 0,
      y2: 1,
      colorStops: [
        { offset: 0, color: `${hex}33` },
        { offset: 1, color: `${hex}00` },
      ],
    },
  });

  const series = metrics.map((m) => {
    const avg = index.get(`${m.field}_avg`);
    const sign = m.negate ? -1 : 1;
    const hasVoltageLimits = m.unit === "V" && metrics.find((x) => x.unit === "V") === m;
    return {
      id: m.id,
      name: metricLabel(m),
      type: "line",
      yAxisIndex: units.indexOf(m.unit),
      showSymbol: false,
      smooth: m.area ? 0.25 : 0,
      sampling: "lttb",
      lineStyle: { width: 1.6, color: color(m) },
      itemStyle: { color: color(m) },
      ...(m.area && metrics.length <= 2 ? { areaStyle: area(color(m)) } : {}),
      data: data.points.map((p) => {
        const v = avg == null ? null : p[avg];
        return [(p[0] as number) * 1000, v == null ? null : (sign * v) / UNIT_SCALE[m.unit]];
      }),
      ...(hasVoltageLimits
        ? {
            markLine: {
              silent: true,
              symbol: "none",
              label: { color: c.subtle, fontSize: 10, formatter: "{c} V" },
              lineStyle: { color: c.subtle, type: "dashed", width: 1 },
              data: [{ yAxis: 207 }, { yAxis: 253 }],
            },
          }
        : {}),
    };
  });

  const yAxis = units.map((unit, i) => ({
    type: "value",
    position: i === 0 ? "left" : "right",
    ...base,
    splitNumber: 3,
    splitLine: { show: i === 0, lineStyle: { color: c.gridLine } },
    name: unit,
    nameTextStyle: { color: c.subtle, fontSize: 11, padding: i === 0 ? [0, 24, 0, 0] : [0, 0, 0, 24] },
    ...(unit === "V"
      ? {
          min: (e: { min: number }) => Math.min(Math.floor(e.min - 2), 205),
          max: (e: { max: number }) => Math.max(Math.ceil(e.max + 2), 255),
        }
      : {}),
    axisLabel: {
      ...base.axisLabel,
      formatter: (v: number) => `${v < 0 ? "−" : ""}${num(Math.abs(v), unit === "kW" ? 1 : 0)}`,
    },
  }));

  const timeLabel = (ts: number) =>
    opts.bucketLabel === "time"
      ? time(ts)
      : opts.bucketLabel === "date"
        ? shortDate(ts)
        : `${weekday(ts)} ${time(ts)}`;

  return {
    animation: false,
    grid: { left: 8, right: units.length > 1 ? 8 : 16, top: 28, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipBase(c),
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: c.border } },
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
          if (avg == null) return "";
          const min = at("min");
          const max = at("max");
          const range =
            opts.showRange && max != null && max !== avg
              ? `<span style="color:${c.muted};margin-left:6px">${
                  min != null
                    ? t("phases.minMax", { min: format(m.unit, min), max: format(m.unit, max) })
                    : t("phases.max", { max: format(m.unit, max) })
                }</span>`
              : "";
          return `${dot(color(m))}${metricLabel(m)} <b style="margin-left:8px">${format(m.unit, avg)} ${m.unit}</b>${range}`;
        });
        return `<div style="color:${c.muted};margin-bottom:4px">${head}</div>${rows.filter(Boolean).join("<br/>")}`;
      },
    },
    xAxis: {
      type: "time",
      min: opts.start * 1000,
      max: opts.end * 1000,
      ...base,
      splitLine: { show: false },
      axisLine: { show: true, lineStyle: { color: c.border } },
      axisLabel: { ...base.axisLabel, hideOverlap: true, formatter: (v: number) => timeLabel(v / 1000) },
    },
    yAxis: yAxis.length ? yAxis : [{ type: "value", ...base }],
    series,
  };
}
