import { useQuery } from "@tanstack/react-query";
import { BatteryCharging, Car, Gauge, Heater, Settings2, Sun } from "lucide-react";
import { Link } from "react-router";
import { Card, CardHeader, PageHeader, Row, StatusDot } from "../components/ui";
import { api } from "../lib/api";
import { duration, number, time } from "../lib/format";

const upcoming = [
  { name: "Solar inverter", icon: Sun },
  { name: "Home battery", icon: BatteryCharging },
  { name: "Heat pump", icon: Heater },
  { name: "EV charger", icon: Car },
];

export function DevicesPage() {
  const { data } = useQuery({ queryKey: ["devices"], queryFn: api.devices, refetchInterval: 5000 });

  return (
    <>
      <PageHeader title="Devices" subtitle="Everything Jouleflow is connected to" />
      <div className="mx-auto flex max-w-[1000px] flex-col gap-4 p-4 sm:gap-6 sm:p-8">
        {data?.map((d) => {
          const signal = d.details.wifi_signal_dbm as number | null;
          return (
            <Card key={d.id}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2.5">
                    <Gauge className="size-[18px] text-import" strokeWidth={1.75} />
                    {d.name}
                  </span>
                }
                description={d.connection}
                action={
                  <div className="flex items-center gap-2">
                    <span className="hidden items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm sm:flex">
                      <StatusDot ok={d.connected} />
                      {d.connected ? "Connected" : "Offline"}
                    </span>
                    <Link
                      to="/settings/p1"
                      aria-label="P1 meter settings"
                      className="grid size-9 place-items-center rounded-lg border border-border text-muted hover:bg-muted-surface hover:text-foreground"
                    >
                      <Settings2 className="size-4" />
                    </Link>
                  </div>
                }
              />
              <div className="divide-y divide-border px-5 pt-3 pb-2 sm:px-6">
                <Row label="Last reading" value={d.last_update ? time(d.last_update, true) : "—"} />
                <Row label="Meter" value={(d.details.meter_id as string) ?? "—"} />
                <Row label="DSMR version" value={formatDsmr(d.details.dsmr_version as string)} />
                <Row label="Gas meter" value={d.details.has_gas ? "Connected" : "Not detected"} />
                <Row
                  label="Wi-Fi signal"
                  value={signal != null ? `${signal} dBm · ${signalQuality(signal)}` : "—"}
                />
                <Row label="Reader uptime" value={duration(d.details.reader_uptime_s as number)} />
                <Row
                  label="Power failures"
                  value={`${number(d.details.power_failures as number)} short · ${number(d.details.long_power_failures as number)} long`}
                />
                <Row label="Reader firmware" value={`ESPHome ${d.details.firmware ?? "—"}`} />
                {d.error && !d.connected && <Row label="Last error" value={d.error} />}
              </div>
            </Card>
          );
        })}

        <Card>
          <CardHeader title="Coming soon" description="More device types are on the roadmap" />
          <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4 sm:p-6">
            {upcoming.map(({ name, icon: Icon }) => (
              <div
                key={name}
                className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted"
              >
                <Icon className="size-5" strokeWidth={1.5} />
                {name}
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
  if (dbm >= -55) return "Excellent";
  if (dbm >= -67) return "Good";
  if (dbm >= -75) return "Fair";
  return "Weak";
}
