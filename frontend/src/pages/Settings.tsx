import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, CircleAlert, Download, Gauge, Lock, LockOpen, LogOut, Plug as PlugIcon, Receipt, Sun } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button, Card, CardHeader, PageHeader, Row, Segmented, StatusDot, TextField } from "../components/ui";
import { api } from "../lib/api";
import { bytes, duration, isoToDate, longDate, number } from "../lib/format";
import { cn } from "../components/ui";
import { LANGUAGES, t, tDynamic, useI18n, type Lang } from "../lib/i18n";
import { useTheme, type ThemeSetting } from "../lib/theme";

export function SettingsPage() {
  const { setting, setSetting } = useTheme();
  const { lang, setLang } = useI18n();
  const { data: sys } = useQuery({ queryKey: ["system"], queryFn: api.system, refetchInterval: 30_000 });
  const { data: live } = useQuery({ queryKey: ["live"], queryFn: api.live, refetchInterval: 10_000 });
  const device = live?.device;
  const { data: tariffs } = useQuery({ queryKey: ["tariffs"], queryFn: api.tariffs });
  const contract = tariffs?.contracts.at(-1);
  const { data: plugData } = useQuery({ queryKey: ["plugs"], queryFn: api.plugs, refetchInterval: 15_000 });
  const plugs = plugData?.plugs ?? [];
  const { data: solarData } = useQuery({ queryKey: ["inverters"], queryFn: api.inverters, refetchInterval: 15_000 });
  const inverters = solarData?.inverters ?? [];

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
              to="/settings/solar"
              className="-mx-3 flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted-surface"
            >
              <Sun className="size-5 text-import" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{t("solar.title")}</div>
                <div className="truncate text-[13px] text-muted">
                  {inverters.length
                    ? `${inverters.map((i) => i.display_name).join(", ")} · ${t("solar.count", {
                        count: inverters.filter((i) => i.connected).length,
                      })}`
                    : t("solar.settingsDescription")}
                </div>
              </div>
              <ChevronRight className="size-4 text-subtle" />
            </Link>
            <Link
              to="/settings/plugs"
              className="-mx-3 flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted-surface"
            >
              <PlugIcon className="size-5 text-import" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{t("plugs.title")}</div>
                <div className="truncate text-[13px] text-muted">
                  {plugs.length
                    ? `${plugs.map((p) => p.display_name).join(", ")} · ${t("plugs.count", {
                        count: plugs.filter((p) => p.connected).length,
                      })}`
                    : t("plugs.settingsDescription")}
                </div>
              </div>
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

        <AccountCard />

        <TlsCard />

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

function AccountCard() {
  const queryClient = useQueryClient();
  const { data: status } = useQuery({ queryKey: ["auth"], queryFn: api.authStatus });
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => queryClient.resetQueries(),
  });
  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setRepeat("");
    },
  });
  const mismatch = repeat.length > 0 && next !== repeat;

  return (
    <Card>
      <CardHeader
        title={t("auth.account")}
        description={status?.username ? t("auth.signedInAs", { username: status.username }) : undefined}
        action={
          <Button type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>
            <LogOut className="size-4" /> {t("auth.signOut")}
          </Button>
        }
      />
      <form
        className="flex flex-col gap-4 p-5 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mismatch) change.mutate();
        }}
      >
        <span className="text-sm font-medium">{t("auth.changePassword")}</span>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField id="pw-current" type="password" autoComplete="current-password" label={t("auth.currentPassword")} value={current} onChange={(e) => setCurrent(e.target.value)} />
          <TextField id="pw-new" type="password" autoComplete="new-password" label={t("auth.newPassword")} help={t("auth.passwordHelp")} value={next} onChange={(e) => setNext(e.target.value)} />
          <TextField id="pw-repeat" type="password" autoComplete="new-password" label={t("auth.passwordRepeat")} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </div>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          {(mismatch || change.isError) && (
            <span className="flex items-center gap-1.5 text-sm text-import sm:mr-auto">
              <CircleAlert className="size-4" />
              {mismatch ? t("auth.mismatch") : tDynamic(`auth.error.${change.error?.message}`, change.error?.message ?? "")}
            </span>
          )}
          {change.isSuccess && (
            <span className="flex items-center gap-1.5 text-sm text-export sm:mr-auto">
              <Check className="size-4" /> {t("auth.passwordChanged")}
            </span>
          )}
          <Button type="submit" disabled={!current || next.length < 10 || mismatch || change.isPending}>
            {t("auth.changePassword")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function TlsCard() {
  const { data } = useQuery({ queryKey: ["tls"], queryFn: api.tls });
  if (!data) return null;
  const Icon = data.secure ? Lock : LockOpen;

  return (
    <Card>
      <CardHeader title={t("tls.title")} description={data.enabled ? t("tls.description") : undefined} />
      <div className="flex flex-col gap-5 p-5 sm:p-6">
        <p className={cn("flex items-start gap-2 text-sm", data.secure ? "text-export" : "text-import")}>
          <Icon className="mt-0.5 size-4 shrink-0" />
          {!data.enabled ? t("tls.disabled") : data.secure ? t("tls.secure") : t("tls.insecure")}
        </p>

        {data.enabled && data.ca_fingerprint && (
          <>
            <div>
              <div className="text-sm font-medium">{t("tls.fingerprint")}</div>
              <code className="mt-1.5 block break-all rounded-lg bg-muted-surface px-3 py-2 font-mono text-xs leading-relaxed">
                {data.ca_fingerprint}
              </code>
              <p className="mt-1.5 text-[13px] text-muted">{t("tls.fingerprintHelp")}</p>
            </div>
            <div className="divide-y divide-border">
              <Row label={t("tls.names")} value={data.names?.join(", ")} />
              <Row label="" value={t("tls.renews", { date: isoToDate(data.server_expires ?? "") })} />
            </div>
            <div className="flex flex-col gap-2 text-[13px] text-muted">
              <span className="text-sm font-medium text-foreground">{t("tls.howTo")}</span>
              <span>{t("tls.ios")}</span>
              <span>{t("tls.android")}</span>
              <span>{t("tls.mac")}</span>
              <span>{t("tls.windows")}</span>
              <span className="text-subtle">{t("tls.limited")}</span>
            </div>
            <div>
              <a
                href="/api/tls/ca.crt"
                download="jouleflow-ca.crt"
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted-surface"
              >
                <Download className="size-4" /> {t("tls.download")}
              </a>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
