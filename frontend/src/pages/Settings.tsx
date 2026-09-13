import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, PageHeader, Row, Segmented } from "../components/ui";
import { api } from "../lib/api";
import { bytes, duration, longDate, number } from "../lib/format";
import { useTheme, type ThemeSetting } from "../lib/theme";

export function SettingsPage() {
  const { setting, setSetting } = useTheme();
  const { data: sys } = useQuery({ queryKey: ["system"], queryFn: api.system, refetchInterval: 30_000 });

  return (
    <>
      <PageHeader title="Settings" />
      <div className="mx-auto flex max-w-[1000px] flex-col gap-4 p-4 sm:gap-6 sm:p-8">
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
