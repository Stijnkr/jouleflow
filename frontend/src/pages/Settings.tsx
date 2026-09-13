import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Gauge, Receipt } from "lucide-react";
import { Link } from "react-router";
import { Card, CardHeader, PageHeader, Row, Segmented, StatusDot } from "../components/ui";
import { api } from "../lib/api";
import { bytes, duration, isoToDate, longDate, number } from "../lib/format";
import { LANGUAGES, t, useI18n, type Lang } from "../lib/i18n";
import { useTheme, type ThemeSetting } from "../lib/theme";

export function SettingsPage() {
  const { setting, setSetting } = useTheme();
  const { lang, setLang } = useI18n();
  const { data: sys } = useQuery({ queryKey: ["system"], queryFn: api.system, refetchInterval: 30_000 });
  const { data: live } = useQuery({ queryKey: ["live"], queryFn: api.live, refetchInterval: 10_000 });
  const device = live?.device;
  const { data: tariffs } = useQuery({ queryKey: ["tariffs"], queryFn: api.tariffs });
  const contract = tariffs?.contracts.at(-1);

  return (
    <>
      <PageHeader title={t("settings.title")} />
      <div className="mx-auto flex max-w-[1000px] flex-col gap-4 p-4 sm:gap-6 sm:p-8">
        <Card>
          <CardHeader title={t("settings.connections")} />
          <div className="px-5 pt-3 pb-3 sm:px-6">
            <Link
              to="/settings/p1"
              className="-mx-3 flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted-surface"
            >
              <Gauge className="size-5 text-import" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{t("settings.p1")}</div>
                <div className="truncate text-[13px] text-muted">
                  {device?.driver ? device.connection : t("status.notConfigured")}
                </div>
              </div>
              {device?.driver && (
                <span className="flex items-center gap-2 text-sm text-muted">
                  <StatusDot ok={device.connected} />
                  {device.connected ? t("common.connected") : t("common.offline")}
                </span>
              )}
              <ChevronRight className="size-4 text-subtle" />
            </Link>
            <Link
              to="/settings/contract"
              className="-mx-3 flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted-surface"
            >
              <Receipt className="size-5 text-import" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{t("settings.contract")}</div>
                <div className="truncate text-[13px] text-muted">
                  {contract
                    ? t("settings.contractSince", {
                        name: contract.name || t("settings.contractFallbackName"),
                        date: isoToDate(contract.start),
                      })
                    : t("settings.contractEmpty")}
                </div>
              </div>
              <ChevronRight className="size-4 text-subtle" />
            </Link>
          </div>
        </Card>

        <Card>
          <CardHeader title={t("settings.appearance")} />
          <div className="flex items-center justify-between gap-4 px-5 py-5 sm:px-6">
            <span className="text-sm text-muted">{t("settings.theme")}</span>
            <Segmented<ThemeSetting>
              value={setting}
              onChange={setSetting}
              options={[
                { value: "light", label: t("theme.light") },
                { value: "dark", label: t("theme.dark") },
                { value: "system", label: t("theme.system") },
              ]}
            />
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border px-5 py-5 sm:px-6">
            <span className="text-sm text-muted">{t("settings.language")}</span>
            <Segmented<Lang> value={lang} onChange={setLang} options={LANGUAGES} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title={t("settings.data")}
            description={t("settings.dataDescription")}
          />
          <div className="divide-y divide-border px-5 pt-3 pb-2 sm:px-6">
            <Row label={t("settings.since")} value={sys?.rows.since ? longDate(sys.rows.since) : "—"} />
            <Row label={t("settings.dbSize")} value={bytes(sys?.db_size_bytes)} />
            <Row
              label={t("settings.everySecond")}
              value={t("settings.everySecondValue", { count: number(sys?.rows.samples), days: sys?.retention.raw_days ?? "—" })}
            />
            <Row
              label={t("settings.perMinute")}
              value={t("settings.perMinuteValue", { count: number(sys?.rows.minutes), years: sys ? Math.round(sys.retention.minute_days / 365) : "—" })}
            />
            <Row label={t("settings.perHour")} value={t("settings.keptForever", { count: number(sys?.rows.hours) })} />
            <Row label={t("settings.perDay")} value={t("settings.keptForever", { count: number(sys?.rows.days) })} />
          </div>
        </Card>

        <Card>
          <CardHeader title={t("settings.system")} />
          <div className="divide-y divide-border px-5 pt-3 pb-2 sm:px-6">
            <Row label={t("settings.device")} value={sys?.model ?? "—"} />
            <Row label={t("settings.version")} value={sys?.version ?? "—"} />
            <Row label={t("settings.cpuTemp")} value={sys?.cpu_temp_c != null ? `${number(sys.cpu_temp_c)} °C` : "—"} />
            <Row label={t("settings.uptime")} value={duration(sys?.uptime_s)} />
            <Row
              label={t("settings.storage")}
              value={
                sys?.disk_free_bytes != null
                  ? t("settings.storageValue", { free: bytes(sys.disk_free_bytes), total: bytes(sys.disk_total_bytes) })
                  : "—"
              }
            />
            <Row label={t("settings.timezone")} value={sys?.timezone ?? "—"} />
          </div>
        </Card>
      </div>
    </>
  );
}
