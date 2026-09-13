import { useQuery } from "@tanstack/react-query";
import { BatteryCharging, Car, Gauge, Heater, Settings2, Sun } from "lucide-react";
import { Link } from "react-router";
import { Card, CardHeader, PageHeader, Row, StatusDot } from "../components/ui";
import { api } from "../lib/api";
import { duration, number, time } from "../lib/format";
import { t } from "../lib/i18n";

const upcoming = [
  { name: "devices.solar", icon: Sun },
  { name: "devices.battery", icon: BatteryCharging },
  { name: "devices.heatPump", icon: Heater },
  { name: "devices.ev", icon: Car },
] as const;

export function DevicesPage() {
  const { data } = useQuery({ queryKey: ["devices"], queryFn: api.devices, refetchInterval: 5000 });

  return (
    <>
      <PageHeader title={t("devices.title")} subtitle={t("devices.subtitle")} />
      <div className="mx-auto flex max-w-[1000px] flex-col gap-4 p-4 sm:gap-6 sm:p-8">
        {data?.map((d) => {
          const signal = d.details.wifi_signal_dbm as number | null;
          return (
            <Card key={d.id}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2.5">
                    <Gauge className="size-[18px] text-import" strokeWidth={1.75} />
                    {t("status.p1")}
                  </span>
                }
                description={d.driver ? d.connection : t("status.notConfigured")}
                action={
                  <div className="flex items-center gap-2">
                    <span className="hidden items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm sm:flex">
                      <StatusDot ok={d.connected} />
                      {d.connected ? t("common.connected") : t("common.offline")}
                    </span>
                    <Link
                      to="/settings/p1"
                      aria-label={t("devices.meterSettings")}
                      className="grid size-9 place-items-center rounded-lg border border-border text-muted hover:bg-muted-surface hover:text-foreground"
                    >
                      <Settings2 className="size-4" />
                    </Link>
                  </div>
                }
              />
              <div className="divide-y divide-border px-5 pt-3 pb-2 sm:px-6">
                <Row label={t("devices.lastReading")} value={d.last_update ? time(d.last_update, true) : "—"} />
                <Row label={t("devices.meter")} value={(d.details.meter_id as string) ?? "—"} />
                <Row label={t("devices.dsmr")} value={formatDsmr(d.details.dsmr_version as string)} />
                <Row label={t("devices.gasMeter")} value={d.details.has_gas ? t("devices.gasConnected") : t("devices.gasNotDetected")} />
                <Row
                  label={t("devices.wifi")}
                  value={signal != null ? `${signal} dBm · ${signalQuality(signal)}` : "—"}
                />
                <Row label={t("devices.uptime")} value={duration(d.details.reader_uptime_s as number)} />
                <Row
                  label={t("devices.failures")}
                  value={t("devices.failuresValue", { short: number(d.details.power_failures as number), long: number(d.details.long_power_failures as number) })}
                />
                <Row label={t("devices.firmware")} value={`ESPHome ${d.details.firmware ?? "—"}`} />
                {d.error && !d.connected && <Row label={t("devices.lastError")} value={d.error} />}
              </div>
            </Card>
          );
        })}

        <Card>
          <CardHeader title={t("common.comingSoon")} description={t("devices.comingSoonDescription")} />
          <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4 sm:p-6">
            {upcoming.map(({ name, icon: Icon }) => (
              <div
                key={name}
                className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted"
              >
                <Icon className="size-5" strokeWidth={1.5} />
                {t(name)}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function formatDsmr(v: string | undefined) {
  if (!v) return "—";
  return v.length === 2 ? `${v[0]}.${v[1]}` : v;
}

function signalQuality(dbm: number) {
  if (dbm >= -55) return t("signal.excellent");
  if (dbm >= -67) return t("signal.good");
  if (dbm >= -75) return t("signal.fair");
  return t("signal.weak");
}
