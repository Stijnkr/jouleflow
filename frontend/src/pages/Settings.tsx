import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Gauge } from "lucide-react";
import { Link } from "react-router";
import { Card, CardHeader, PageHeader, Row, Segmented, StatusDot } from "../components/ui";
import { api } from "../lib/api";
import { bytes, duration, longDate, number } from "../lib/format";
import { useTheme, type ThemeSetting } from "../lib/theme";

export function SettingsPage() {
  const { setting, setSetting } = useTheme();
  const { data: sys } = useQuery({ queryKey: ["system"], queryFn: api.system, refetchInterval: 30_000 });
  const { data: live } = useQuery({ queryKey: ["live"], queryFn: api.live, refetchInterval: 10_000 });
  const device = live?.device;

  return (
    <>
      <PageHeader title="Settings" />
      <div className="mx-auto flex max-w-[1000px] flex-col gap-4 p-4 sm:gap-6 sm:p-8">
        <Card>
          <CardHeader title="Connections" />
          <div className="px-5 pt-3 pb-3 sm:px-6">
            <Link
              to="/settings/p1"
              className="-mx-3 flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted-surface"
            >
              <Gauge className="size-5 text-import" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">P1 meter</div>
                <div className="truncate text-[13px] text-muted">
                  {device?.connection ?? "Not configured"}
                </div>
              </div>
              {device && device.connection !== "Not configured" && (
                <span className="flex items-center gap-2 text-sm text-muted">
                  <StatusDot ok={device.connected} />
                  {device.connected ? "Connected" : "Offline"}
                </span>
              )}
              <ChevronRight className="size-4 text-subtle" />
            </Link>
          </div>
        </Card>

        <Card>
          <CardHeader title="Appearance" />
          <div className="flex items-center justify-between gap-4 px-5 py-5 sm:px-6">
            <span className="text-sm text-muted">Theme</span>
            <Segmented<ThemeSetting>
              value={setting}
              onChange={setSetting}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "system", label: "System" },
              ]}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Data & storage"
            description="All data is stored locally on this device"
          />
          <div className="divide-y divide-border px-5 pt-3 pb-2 sm:px-6">
            <Row label="Collecting since" value={sys?.rows.since ? longDate(sys.rows.since) : "—"} />
            <Row label="Database size" value={bytes(sys?.db_size_bytes)} />
            <Row
              label="Every second"
              value={`${number(sys?.rows.samples)} readings · kept ${sys?.retention.raw_days ?? "—"} days`}
            />
            <Row
              label="Per minute"
              value={`${number(sys?.rows.minutes)} rows · kept ${sys ? Math.round(sys.retention.minute_days / 365) : "—"} years`}
            />
            <Row label="Per hour" value={`${number(sys?.rows.hours)} rows · kept forever`} />
            <Row label="Per day" value={`${number(sys?.rows.days)} rows · kept forever`} />
          </div>
        </Card>

        <Card>
          <CardHeader title="System" />
          <div className="divide-y divide-border px-5 pt-3 pb-2 sm:px-6">
            <Row label="Device" value={sys?.model ?? "—"} />
            <Row label="Jouleflow version" value={sys?.version ?? "—"} />
            <Row label="CPU temperature" value={sys?.cpu_temp_c != null ? `${sys.cpu_temp_c} °C` : "—"} />
            <Row label="Uptime" value={duration(sys?.uptime_s)} />
            <Row
              label="Storage"
              value={
                sys?.disk_free_bytes != null
                  ? `${bytes(sys.disk_free_bytes)} free of ${bytes(sys.disk_total_bytes)}`
                  : "—"
              }
            />
            <Row label="Timezone" value={sys?.timezone ?? "—"} />
          </div>
        </Card>
      </div>
    </>
  );
}
