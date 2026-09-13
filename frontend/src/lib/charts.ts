import type { ChartOption } from "../components/Chart";
import type { PowerPoint } from "./api";
import { axisPower, energy, powerText, shortDate, time, weekday } from "./format";
import { readTokens } from "./theme";

type Tokens = ReturnType<typeof readTokens>;

function tooltipBase(t: Tokens) {
  return {
    backgroundColor: t.card,
    borderColor: t.border,
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: t.foreground, fontSize: 12, fontFamily: "Inter Variable, sans-serif" },
    extraCssText: "border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);",
  };
}

function axisBase(t: Tokens) {
  return {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: t.subtle, fontSize: 11, fontFamily: "Inter Variable, sans-serif" },
    splitLine: { lineStyle: { color: t.gridLine } },
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
  const t = readTokens();
  const hasExport = points.some((p) => p[2] > 0);
  const base = axisBase(t);
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
      ...tooltipBase(t),
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: t.border } },
      formatter: (params: { value: [number, number]; seriesName: string; color: string }[]) => {
        if (!params.length) return "";
        const ts = params[0].value[0] / 1000;
        const head =
          opts.bucketLabel === "time" ? time(ts, true) : `${weekday(ts)} ${shortDate(ts)}, ${time(ts)}`;
        const rows = params
          .filter((p) => Math.abs(p.value[1]) > 0.5 || p.seriesName === "Grid import")
          .map((p) => `${dot(p.color)}${p.seriesName} <b style="margin-left:8px">${powerText(Math.abs(p.value[1]))}</b>`);
        return `<div style="color:${t.muted};margin-bottom:4px">${head}</div>${rows.join("<br/>")}`;
      },
    },
    xAxis: {
      type: "time",
      min: opts.start * 1000,
      max: opts.end * 1000,
      ...base,
      splitLine: { show: false },
      axisLine: { show: true, lineStyle: { color: t.border } },
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
        name: "Grid import",
        type: "line",
        showSymbol: false,
        smooth: 0.25,
        sampling: "lttb",
        lineStyle: { width: 1.75, color: t.import },
        itemStyle: { color: t.import },
        areaStyle: area(t.import),
        data: points.map((p) => [p[0] * 1000, p[1]]),
      },
      {
        name: "Grid export",
        type: "line",
        showSymbol: false,
        smooth: 0.25,
        sampling: "lttb",
        lineStyle: { width: hasExport ? 1.75 : 0, color: t.export },
        itemStyle: { color: t.export },
        areaStyle: area(t.export),
        data: points.map((p) => [p[0] * 1000, -p[2]]),
      },
    ],
  };
}

/** Energy bars per bucket: import up, export down. */
export function energyBarsOption(
  bars: [number, number | null, number | null, number | null][],
  label: (ts: number) => string,
  tooltipLabel: (ts: number) => string,
): ChartOption {
  const t = readTokens();
  const base = axisBase(t);
  return {
    animationDuration: 300,
    grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipBase(t),
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: `${t.border}66` } },
      formatter: (params: { dataIndex: number }[]) => {
        const b = bars[params[0].dataIndex];
        const rows = [`${dot(t.import)}Imported <b style="margin-left:8px">${energy(b[1])} kWh</b>`];
        if (b[2]) rows.push(`${dot(t.export)}Exported <b style="margin-left:8px">${energy(b[2])} kWh</b>`);
        if (b[3] != null) rows.push(`${dot(t.gas)}Gas <b style="margin-left:8px">${energy(b[3], 3)} m³</b>`);
        return `<div style="color:${t.muted};margin-bottom:4px">${tooltipLabel(b[0])}</div>${rows.join("<br/>")}`;
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
      axisLabel: { ...base.axisLabel, formatter: (v: number) => `${v < 0 ? "−" : ""}${Math.abs(v)}` },
    },
    series: [
      {
        name: "Imported",
        type: "bar",
        stack: "energy",
        barMaxWidth: 28,
        itemStyle: { color: t.import, borderRadius: [3, 3, 0, 0] },
        data: bars.map((b) => b[1]),
      },
      {
        name: "Exported",
        type: "bar",
        stack: "energy",
        barMaxWidth: 28,
        itemStyle: { color: t.export, borderRadius: [0, 0, 3, 3] },
        data: bars.map((b) => (b[2] == null ? null : -b[2])),
      },
    ],
  };
}
