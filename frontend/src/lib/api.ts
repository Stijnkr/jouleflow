export type Phase = { power: number | null; voltage: number | null; current: number | null };

export type Reading = {
  ts: number;
  power_import: number;
  power_export: number;
  power_net: number;
  phases: Phase[];
  gas: number | null;
};

export type DeviceStatus = {
  id: string;
  name: string;
  kind: string;
  connection: string;
  driver: string | null;
  options: Record<string, string>;
  connected: boolean;
  last_update: number | null;
  error: string | null;
  details: Record<string, string | number | boolean | null>;
};

export type LiveResponse = { reading: Reading | null; fresh: boolean; device: DeviceStatus };

export type Energy = { import: number | null; export: number | null; gas: number | null };

export type Summary = {
  day_start: number;
  today: Energy;
  yesterday_same_time: Energy;
  yesterday: Energy;
  change_pct: { import: number | null; export: number | null; gas: number | null };
  peak_import: { ts: number; w: number } | null;
  peak_export: { ts: number; w: number } | null;
  export_window: { start: number; end: number } | null;
};

export type PowerRange = "hour" | "day" | "week";
/** [ts, import W, export W] */
export type PowerPoint = [number, number, number];

export type PowerSeries = {
  range: PowerRange;
  bucket_seconds: number;
  start: number;
  end: number;
  points: PowerPoint[];
};

export type Period = "day" | "week" | "month" | "year";

export type Totals = {
  import: number | null;
  import_low: number | null;
  import_normal: number | null;
  export: number | null;
  export_low: number | null;
  export_normal: number | null;
  net: number | null;
  gas: number | null;
  peak_import_w: number | null;
  peak_export_w: number | null;
};

export type History = {
  period: Period;
  anchor: string;
  start: number;
  end: number;
  /** [bucket start, import kWh, export kWh, gas m³] */
  bars: [number, number | null, number | null, number | null][];
  power: PowerPoint[];
  totals: Totals;
  previous: Totals & { start: number; end: number };
  first_data: number | null;
};

export type SystemInfo = {
  version: string;
  model?: string;
  cpu_temp_c?: number;
  uptime_s?: number;
  db_size_bytes?: number;
  disk_free_bytes?: number;
  disk_total_bytes?: number;
  timezone: string;
  retention: { raw_days: number; minute_days: number; hourly: string; daily: string };
  rows: { samples?: number; minutes?: number; hours?: number; days?: number; since?: number | null };
};

export type DriverField = {
  key: string;
  label: string;
  placeholder: string;
  help: string;
  required: boolean;
};

export type DriverInfo = {
  id: string;
  name: string;
  description: string;
  fields: DriverField[];
  available: boolean;
};

export type P1Config = { driver: string; options: Record<string, string> };

export type P1ConfigResponse = {
  configured: boolean;
  driver: string | null;
  options: Record<string, string>;
};

export type ProbeResult =
  | { ok: false; error: string }
  | {
      ok: true;
      url: string;
      meter_id: string | null;
      dsmr_version: string | null;
      power_net_w: number | null;
      has_gas: boolean;
      wifi_signal_dbm: number | null;
    };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

const get = <T,>(path: string) => request<T>(path);

export const api = {
  live: () => get<LiveResponse>("/api/live"),
  summary: () => get<Summary>("/api/summary"),
  power: (range: PowerRange) => get<PowerSeries>(`/api/power?range=${range}`),
  history: (period: Period, date: string) =>
    get<History>(`/api/history?period=${period}&date=${date}`),
  devices: () => get<DeviceStatus[]>("/api/devices"),
  system: () => get<SystemInfo>("/api/system"),
  p1Drivers: () => get<DriverInfo[]>("/api/p1/drivers"),
  p1Config: () => get<P1ConfigResponse>("/api/p1/config"),
  p1Test: (config: P1Config) =>
    request<ProbeResult>("/api/p1/test", { method: "POST", body: JSON.stringify(config) }),
  p1Save: (config: P1Config) =>
    request<DeviceStatus>("/api/p1/config", { method: "PUT", body: JSON.stringify(config) }),
};
