import { locale, t } from "./i18n";

/** Locale-aware number with a fixed number of decimals. */
export function num(value: number, digits = 0): string {
  return value.toLocaleString(locale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Power in W → value + unit, e.g. 740 → ["740", "W"], 1710 → ["1,71", "kW"]. */
export function power(w: number | null | undefined): [string, string] {
  if (w == null) return ["—", ""];
  const abs = Math.abs(w);
  if (abs < 1000) return [num(Math.round(abs)), "W"];
  return [num(abs / 1000, abs < 10_000 ? 2 : 1), "kW"];
}

export function powerText(w: number | null | undefined): string {
  const [v, u] = power(w);
  return u ? `${v} ${u}` : v;
}

export function kw(w: number | null | undefined, digits = 2): string {
  if (w == null) return "—";
  return num(w / 1000, digits);
}

export function energy(kwh: number | null | undefined, digits = 2): string {
  if (kwh == null) return "—";
  return num(kwh, kwh >= 1000 ? 0 : digits);
}

export function euro(value: number | null | undefined, digits = 2): string {
  if (value == null) return "—";
  // Round first so tiny negatives don't show as "-0,00".
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits || 0;
  return rounded.toLocaleString(locale(), {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function time(ts: number, seconds = false): string {
  return new Date(ts * 1000).toLocaleTimeString(locale(), {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
  });
}

export function longDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(locale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function shortDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(locale(), { day: "numeric", month: "short" });
}

/** A YYYY-MM-DD date string shown in the local format. */
export function isoToDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function weekday(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(locale(), { weekday: "short" });
}

export function monthName(ts: number, style: "short" | "long" = "short"): string {
  return new Date(ts * 1000).toLocaleDateString(locale(), { month: style });
}

export function bytes(n: number | undefined): string {
  if (n == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${num(v, v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function duration(seconds: number | undefined | null): string {
  if (seconds == null) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return t("duration.days", { d, h });
  if (h) return t("duration.hours", { h, m });
  return t("duration.minutes", { m });
}

export function number(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString(locale());
}

/** Local date as YYYY-MM-DD. */
export function isoDate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
