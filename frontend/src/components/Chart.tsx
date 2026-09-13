import { BarChart, LineChart } from "echarts/charts";
import {
  DataZoomInsideComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  MarkLineComponent,
  DataZoomInsideComponent,
  CanvasRenderer,
]);

export type ChartOption = echarts.EChartsCoreOption;

type Props = {
  option: ChartOption;
  className?: string;
  /** Replace the whole option instead of merging (use when series change shape). */
  notMerge?: boolean;
  /** Called with the visible x-range (axis values) after the user zooms or pans. */
  onDataZoom?: (range: [number, number]) => void;
};

export function Chart({ option, className, notMerge = false, onDataZoom }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const zoomHandler = useRef(onDataZoom);
  zoomHandler.current = onDataZoom;

  useEffect(() => {
    if (!el.current) return;
    const instance = echarts.init(el.current, null, { renderer: "canvas" });
    chart.current = instance;
    instance.on("datazoom", () => {
      const zoom = (instance.getOption().dataZoom as { startValue?: number; endValue?: number }[] | undefined)?.[0];
      if (zoom?.startValue != null && zoom.endValue != null) {
        zoomHandler.current?.([zoom.startValue, zoom.endValue]);
      }
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(el.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge, lazyUpdate: true });
  }, [option, notMerge]);

  return <div ref={el} className={className} />;
}
