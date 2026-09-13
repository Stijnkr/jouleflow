import { BarChart, LineChart } from "echarts/charts";
import {
  DataZoomSliderComponent,
  GridComponent,
  MarkLineComponent,
  ToolboxComponent,
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
  ToolboxComponent,
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
    instance.getZr().on("dblclick", () => handlers.current.onDoubleClick?.());

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
    if (brushZoom && finePointer()) {
      // Keep the (hidden) toolbox zoom-select cursor active so dragging selects a range.
      instance.dispatchAction({
        type: "takeGlobalCursor",
        key: "dataZoomSelect",
        dataZoomSelectActive: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option, notMerge, brushZoom]);

  return <div ref={el} className={className} />;
}
