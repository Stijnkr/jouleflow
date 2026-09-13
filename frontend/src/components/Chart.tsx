import { BarChart, LineChart } from "echarts/charts";
import {
  DataZoomSliderComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef, type MutableRefObject } from "react";

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  DataZoomSliderComponent,
  CanvasRenderer,
]);

export type ChartOption = echarts.EChartsCoreOption;
export type ChartInstance = echarts.ECharts;

/** Visible part of the x-axis after zooming, or null when the whole range is shown. */
export type ZoomRange = [number, number] | null;

type Props = {
  option: ChartOption;
  className?: string;
  /** Replace the whole option on every change. Otherwise only these components are replaced,
   * and state such as zoom survives data updates. */
  notMerge?: boolean;
  replaceMerge?: string[];
  /** Enable drag-to-select zooming on the plot (mouse and trackpad only). */
  brushZoom?: boolean;
  onZoom?: (range: ZoomRange) => void;
  onDoubleClick?: () => void;
  chartRef?: MutableRefObject<ChartInstance | null>;
};

const finePointer = () =>
  typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;

export function Chart({
  option,
  className,
  notMerge = false,
  replaceMerge,
  brushZoom = false,
  onZoom,
  onDoubleClick,
  chartRef,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const selection = useRef<HTMLDivElement>(null);
  const chart = useRef<ChartInstance | null>(null);
  const handlers = useRef({ onZoom, onDoubleClick });
  handlers.current = { onZoom, onDoubleClick };

  useEffect(() => {
    if (!el.current) return;
    const instance = echarts.init(el.current, null, { renderer: "canvas" });
    chart.current = instance;
    if (chartRef) chartRef.current = instance;

    instance.on("datazoom", () => {
      const zoom = (
        instance.getOption().dataZoom as
          | { start?: number; end?: number; startValue?: number; endValue?: number }[]
          | undefined
      )?.[0];
      if (!zoom) return;
      const whole = (zoom.start ?? 0) <= 0.01 && (zoom.end ?? 100) >= 99.99;
      handlers.current.onZoom?.(
        whole || zoom.startValue == null || zoom.endValue == null
          ? null
          : [zoom.startValue, zoom.endValue],
      );
    });
    const zr = instance.getZr();
    zr.on("dblclick", () => handlers.current.onDoubleClick?.());

    if (brushZoom && finePointer()) {
      // Drag across the plot to select a time range, then zoom to it.
      let startX: number | null = null;
      const box = selection.current!;
      const hide = () => {
        startX = null;
        box.style.display = "none";
      };
      zr.on("mousedown", (e) => {
        const button = (e.event as unknown as MouseEvent).button;
        if (button !== 0 || !instance.containPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY])) return;
        startX = e.offsetX;
      });
      zr.on("mousemove", (e) => {
        if (startX == null) return;
        const left = Math.min(startX, e.offsetX);
        const width = Math.abs(e.offsetX - startX);
        if (width < 4) return;
        box.style.display = "block";
        box.style.left = `${left}px`;
        box.style.width = `${width}px`;
      });
      zr.on("mouseup", (e) => {
        if (startX == null) return;
        const from = startX;
        hide();
        if (Math.abs(e.offsetX - from) < 8) return;
        const [a, b] = [from, e.offsetX].sort((x, y) => x - y);
        const toValue = (x: number) =>
          instance.convertFromPixel({ xAxisIndex: 0 }, x) as unknown as number;
        instance.dispatchAction({
          type: "dataZoom",
          dataZoomIndex: 0,
          startValue: toValue(a),
          endValue: toValue(b),
        });
      });
      zr.on("globalout", hide);
    }

    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(el.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
      if (chartRef) chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;
    instance.setOption(option, notMerge ? { notMerge: true } : { replaceMerge });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option, notMerge]);

  return (
    <div className={`relative ${className ?? ""}`}>
      <div ref={el} className="absolute inset-0" />
      {/* Selection box; spans the plot area between the axis names and the navigator. */}
      <div
        ref={selection}
        className="pointer-events-none absolute top-6 bottom-16 hidden rounded-sm border-x border-foreground/40 bg-foreground/10"
      />
    </div>
  );
}
