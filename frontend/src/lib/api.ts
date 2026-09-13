import { t } from "./i18n";

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
  change_pct: {
    import: number | null;
    export: number | null;
    gas: number | null;
    cost: number | null;
  };
  cost_today: Cost | null;
  rate_now: RateNow | null;
  peak_import: { ts: number; w: number } | null;
  peak_export: { ts: number; w: number } | null;
  export_window: { start: number; end: number } | null;
};

export type PowerRange = "15m" | "hour" | "6h" | "day" | "week";

/** Measurements over time. Each point lists values in the order of `fields` ("ts" first). */
export type Series = {
  bucket_seconds: number;
  start: number;
  end: number;
  fields: string[];
  points: (number | null)[][];
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

export type Bar = [number, number | null, number | null, number | null, number | null];

export type History = {
  period: Period;
  anchor: string;
  start: number;
  end: number;
  /** [bucket start, import kWh, export kWh, gas m³, cost €] */
  bars: Bar[];
  totals: Totals & { cost: Cost | null };
  previous: Totals & { start: number; end: number; cost: Cost | null };
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

export type Cost = {
  import: number;
  export_credit: number;
  export_cost: number;
  gas: number;
  fixed: number;
  total: number;
};

export type RateNow = {
  rate: "single" | "normal" | "low";
  import_price: number;
  export_value: number;
  netting: boolean;
  contract: string;
  contract_end: string | null;
};

export type FeedInPeriod = { start: string; compensation: number; cost: number };

export type Contract = {
  name: string;
  start: string;
  end: string | null;
  meter: "single" | "dual";
  supply_single: number;
  supply_normal: number;
  supply_low: number;
  energy_tax: number;
  surcharge: number;
  normal_start_hour: number;
  normal_end_hour: number;
  netting_until: string | null;
  feed_in: FeedInPeriod[];
  fixed_supply_month: number;
  grid_day: number;
  tax_reduction_day: number;
  gas_enabled: boolean;
  gas_price: number;
  gas_fixed_month: number;
  gas_grid_day: number;
};

export type TariffSettings = { contracts: Contract[] };

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
  | { ok: false; error: string; code?: string; url?: string }
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
    const detail = Array.isArray(body?.detail) ? t("contract.invalid") : body?.detail;
    throw new Error(detail ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

const get = <T,>(path: string) => request<T>(path);

export const api = {
  live: () => get<LiveResponse>("/api/live"),
  summary: () => get<Summary>("/api/summary"),
  series: (range: PowerRange) => get<Series>(`/api/series?range=${range}`),
  history: (period: Period, date: string) =>
    get<History>(`/api/history?period=${period}&date=${date}`),
  historySeries: (period: Period, date: string) =>
    get<Series>(`/api/history/series?period=${period}&date=${date}`),
  devices: () => get<DeviceStatus[]>("/api/devices"),
  system: () => get<SystemInfo>("/api/system"),
  tariffs: () => get<TariffSettings>("/api/tariffs"),
  saveTariffs: (settings: TariffSettings) =>
    request<TariffSettings>("/api/tariffs", { method: "PUT", body: JSON.stringify(settings) }),
  p1Drivers: () => get<DriverInfo[]>("/api/p1/drivers"),
  p1Config: () => get<P1ConfigResponse>("/api/p1/config"),
  p1Test: (config: P1Config) =>
    request<ProbeResult>("/api/p1/test", { method: "POST", body: JSON.stringify(config) }),
  p1Save: (config: P1Config) =>
    request<DeviceStatus>("/api/p1/config", { method: "PUT", body: JSON.stringify(config) }),
};
