import type { ChartOption } from "../components/Chart";
import type { Bar, PhaseHistory, PowerPoint } from "./api";
import { axisPower, energy, euro, num, number, powerText, shortDate, time, weekday } from "./format";
import { t } from "./i18n";
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

/** Import above zero, export below zero, over a time axis. */
export function powerChartOption(
  points: PowerPoint[],
  opts: { start: number; end: number; bucketLabel: "time" | "datetime" },
): ChartOption {
  const c = readTokens();
  const hasExport = points.some((p) => p[2] > 0);
  const base = axisBase(c);
  const area = (color: string) => ({
    color: {
      type: "linear",
      x: 0,
      y: 0,
      x2: 0,
      y2: 1,
      colorStops: [
        { offset: 0, color: `${color}33` },
        { offset: 1, color: `${color}00` },
      ],
    },
  });

  return {
    animation: false,
    grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipBase(c),
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: c.border } },
      formatter: (params: { value: [number, number]; seriesName: string; color: string }[]) => {
        if (!params.length) return "";
        const ts = params[0].value[0] / 1000;
        const head =
          opts.bucketLabel === "time" ? time(ts, true) : `${weekday(ts)} ${shortDate(ts)}, ${time(ts)}`;
        const rows = params
          .filter((p) => Math.abs(p.value[1]) > 0.5 || p.seriesName === t("legend.gridImport"))
          .map((p) => `${dot(p.color)}${p.seriesName} <b style="margin-left:8px">${powerText(Math.abs(p.value[1]))}</b>`);
        return `<div style="color:${c.muted};margin-bottom:4px">${head}</div>${rows.join("<br/>")}`;
      },
    },
    xAxis: {
      type: "time",
      min: opts.start * 1000,
      max: opts.end * 1000,
      ...base,
      splitLine: { show: false },
      axisLine: { show: true, lineStyle: { color: c.border } },
      axisLabel: {
        ...base.axisLabel,
        hideOverlap: true,
        formatter: (v: number) =>
          opts.bucketLabel === "time" ? time(v / 1000) : `${weekday(v / 1000)}`,
      },
    },
    yAxis: {
      type: "value",
      ...base,
      splitNumber: 3,
      axisLabel: { ...base.axisLabel, formatter: (v: number) => axisPower(v) },
    },
    series: [
      {
        name: t("legend.gridImport"),
        type: "line",
        showSymbol: false,
        smooth: 0.25,
        sampling: "lttb",
        lineStyle: { width: 1.75, color: c.import },
        itemStyle: { color: c.import },
        areaStyle: area(c.import),
        data: points.map((p) => [p[0] * 1000, p[1]]),
      },
      {
        name: t("legend.gridExport"),
        type: "line",
        showSymbol: false,
        smooth: 0.25,
        sampling: "lttb",
        lineStyle: { width: hasExport ? 1.75 : 0, color: c.export },
        itemStyle: { color: c.export },
        areaStyle: area(c.export),
        data: points.map((p) => [p[0] * 1000, -p[2]]),
      },
    ],
  };
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

export type PhaseMetric = "p" | "i" | "v";

const METRIC_UNIT: Record<PhaseMetric, string> = { p: "kW", i: "A", v: "V" };

/** One line per phase (average), with min/max in the tooltip. */
export function phaseChartOption(
  data: PhaseHistory,
  metric: PhaseMetric,
  opts: { bucketLabel: "time" | "date" },
): ChartOption {
  const c = readTokens();
  const base = axisBase(c);
  const colors = [c.l1, c.l2, c.l3];
  const col = (name: string) => data.fields.indexOf(name);
  const scale = metric === "p" ? 1000 : 1;
  const digits = metric === "p" ? 2 : metric === "i" ? 1 : 0;
  const unit = METRIC_UNIT[metric];
  const value = (v: number | null | undefined) => (v == null ? "—" : num(v / scale, digits));

  const series = [1, 2, 3].map((ph) => {
    const avg = col(`${metric}_l${ph}_avg`);
    return {
      name: `L${ph}`,
      type: "line",
      showSymbol: false,
      sampling: "lttb",
      lineStyle: { width: 1.5, color: colors[ph - 1] },
      itemStyle: { color: colors[ph - 1] },
      data: data.points.map((p) => [(p[0] as number) * 1000, p[avg] == null ? null : (p[avg] as number) / scale]),
      ...(metric === "v" && ph === 1
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

  return {
    animation: false,
    grid: { left: 8, right: 36, top: 16, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipBase(c),
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: c.border } },
      formatter: (params: { dataIndex: number }[]) => {
        if (!params.length) return "";
        const point = data.points[params[0].dataIndex];
        const ts = point[0] as number;
        const head = opts.bucketLabel === "time" ? time(ts) : `${weekday(ts)} ${shortDate(ts)}`;
        const rows = [1, 2, 3].map((ph) => {
          const avg = point[col(`${metric}_l${ph}_avg`)];
          if (avg == null) return "";
          const max = point[col(`${metric}_l${ph}_max`)];
          const minIdx = col(`${metric}_l${ph}_min`);
          const range =
            minIdx >= 0
              ? t("phases.minMax", { min: value(point[minIdx]), max: value(max) })
              : t("phases.max", { max: value(max) });
          return `${dot(colors[ph - 1])}L${ph} <b style="margin-left:8px">${value(avg)} ${unit}</b> <span style="color:${c.muted};margin-left:6px">${range}</span>`;
        });
        return `<div style="color:${c.muted};margin-bottom:4px">${head}</div>${rows.filter(Boolean).join("<br/>")}`;
      },
    },
    xAxis: {
      type: "time",
      min: data.start * 1000,
      max: data.end * 1000,
      ...base,
      splitLine: { show: false },
      axisLine: { show: true, lineStyle: { color: c.border } },
      axisLabel: {
        ...base.axisLabel,
        hideOverlap: true,
        formatter: (v: number) => (opts.bucketLabel === "time" ? time(v / 1000) : shortDate(v / 1000)),
      },
    },
    yAxis: {
      type: "value",
      scale: metric === "v",
      ...base,
      splitNumber: 3,
      ...(metric === "v" ? { min: (e: { min: number }) => Math.min(Math.floor(e.min - 2), 205), max: (e: { max: number }) => Math.max(Math.ceil(e.max + 2), 255) } : {}),
      axisLabel: { ...base.axisLabel, formatter: (v: number) => `${num(v, metric === "p" ? 1 : 0)}` },
    },
    series,
  };
}
