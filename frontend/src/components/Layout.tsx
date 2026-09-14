import { useQuery } from "@tanstack/react-query";
import { Activity, ChartColumn, Plug, SlidersHorizontal, Zap } from "lucide-react";
import { NavLink, Outlet } from "react-router";
import { api } from "../lib/api";
import { powerText, time } from "../lib/format";
import { t } from "../lib/i18n";
import { useLive, useNow } from "../lib/live";
import { cn, StatusDot } from "./ui";

const nav = [
  { to: "/", label: "nav.live", icon: Activity },
  { to: "/history", label: "nav.history", icon: ChartColumn },
  { to: "/devices", label: "nav.devices", icon: Plug },
  { to: "/settings", label: "nav.settings", icon: SlidersHorizontal },
] as const;

function MeterStatus() {
  const { reading, connected } = useLive();
  const now = useNow();
  const { data } = useQuery({ queryKey: ["live"], queryFn: api.live, refetchInterval: 30_000 });
  const fresh = connected && reading != null && now - reading.ts < 15;
  const configured = Boolean(data?.device.driver);
  const via = data?.device.connection.split(" · ")[0] ?? "P1";

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <StatusDot ok={fresh} />
        {t("status.p1")}
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        {data && !configured
          ? t("status.notConfigured")
          : fresh
            ? t("status.connectedVia", { via })
            : connected
              ? t("status.waiting")
              : t("status.reconnecting")}
        <br />
        <span className="tabular">
          {reading ? t("status.lastReading", { time: time(reading.ts, true) }) : t("status.noReadings")}
        </span>
      </p>
    </div>
  );
}

function SolarStatus() {
  const { data } = useQuery({ queryKey: ["inverters"], queryFn: api.inverters, refetchInterval: 15_000 });
  const inverters = data?.inverters ?? [];
  if (!inverters.length) return null;
  const fresh = inverters.some((i) => i.fresh);
  const asleep = !fresh && inverters.every((i) => i.error_code === "no_response" || i.fresh);
  const power = inverters.reduce((sum, i) => sum + (i.fresh ? (i.power ?? 0) : 0), 0);
  return (
    <div className="mt-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <StatusDot ok={fresh || asleep} />
        {t("status.solar")}
      </div>
      <p className="tabular mt-2 text-[13px] leading-relaxed text-muted">
        {fresh
          ? t("status.solarProducing", { power: powerText(power) })
          : asleep
            ? t("status.solarAsleep")
            : t("common.offline")}
      </p>
    </div>
  );
}

export function Layout() {
  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-sidebar p-4 lg:flex">
        <div className="flex items-center gap-2.5 px-2 pt-2 pb-6">
          <Zap className="size-5 text-import" strokeWidth={2.25} />
          <span className="text-[17px] font-semibold tracking-tight">Jouleflow</span>
        </div>
        <nav className="flex flex-col gap-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] transition-colors",
                  isActive
                    ? "bg-muted-surface font-medium text-foreground"
                    : "text-muted hover:bg-muted-surface/60 hover:text-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn("size-[18px]", isActive && "text-import")} strokeWidth={1.75} />
                  {t(label)}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto">
          <MeterStatus />
          <SolarStatus />
        </div>
      </aside>

      <main className="min-w-0 flex-1 pb-24 lg:pb-0">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
                isActive ? "text-foreground" : "text-subtle",
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={cn("size-5", isActive && "text-import")} strokeWidth={1.75} />
                {t(label)}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
