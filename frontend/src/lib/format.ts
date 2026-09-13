const locale = "en-GB";

/** Power in W → value + unit, e.g. 740 → ["0.74", "kW"]. */
export function power(w: number | null | undefined): [string, string] {
  if (w == null) return ["—", ""];
  const abs = Math.abs(w);
  if (abs < 1000) return [Math.round(abs).toString(), "W"];
  return [(abs / 1000).toFixed(abs < 10_000 ? 2 : 1), "kW"];
}

export function powerText(w: number | null | undefined): string {
  const [v, u] = power(w);
  return u ? `${v} ${u}` : v;
}

export function kw(w: number | null | undefined, digits = 2): string {
  if (w == null) return "—";
  return (w / 1000).toFixed(digits);
}

export function energy(kwh: number | null | undefined, digits = 2): string {
  if (kwh == null) return "—";
  return kwh.toFixed(kwh >= 1000 ? 0 : digits);
}

export function axisPower(w: number): string {
  const abs = Math.abs(w);
  const sign = w < 0 ? "−" : "";
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k`;
  return `${sign}${abs}`;
}

export function time(ts: number, seconds = false): string {
  return new Date(ts * 1000).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
  });
}

export function longDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function shortDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(locale, { day: "numeric", month: "short" });
}

export function weekday(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(locale, { weekday: "short" });
}

export function monthName(ts: number, style: "short" | "long" = "short"): string {
  return new Date(ts * 1000).toLocaleDateString(locale, { month: style });
}

export function euro(value: number | null | undefined, digits = 2): string {
  if (value == null) return "—";
  const sign = value < 0 ? "−" : "";
  return `${sign}€${Math.abs(value).toFixed(digits)}`;
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
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function duration(seconds: number | undefined | null): string {
  if (seconds == null) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function number(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString(locale);
}

/** Local date as YYYY-MM-DD. */
export function isoDate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
