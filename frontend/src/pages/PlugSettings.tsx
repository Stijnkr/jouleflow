import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CircleAlert, LoaderCircle, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button, Card, CardHeader, PageHeader } from "../components/ui";
import { api, type PlugConfig, type PlugTestResult } from "../lib/api";
import { powerText } from "../lib/format";
import { t, tDynamic } from "../lib/i18n";

const inputClass =
  "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition placeholder:text-subtle focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10";

type Row = PlugConfig & { key: string };

let keySeq = 0;
const newKey = () => `row-${++keySeq}`;

export function PlugSettingsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["plug-settings"], queryFn: api.plugSettings });

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [tests, setTests] = useState<Record<string, PlugTestResult | "pending">>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (query.data && rows === null) {
      setUsername(query.data.username);
      setRows(query.data.plugs.map((p) => ({ ...p, key: newKey() })));
    }
  }, [query.data, rows]);

  const discover = useMutation({ mutationFn: api.discoverPlugs });

  const save = useMutation({
    mutationFn: () =>
      api.savePlugSettings({
        username: username.trim(),
        password: password === "" ? null : password,
        plugs: (rows ?? [])
          .filter((r) => r.host.trim())
          .map(({ id, host, name }) => ({ id, host: host.trim(), name: name.trim() })),
      }),
    onSuccess: (data) => {
      setSaved(true);
      setPassword("");
      queryClient.setQueryData(["plug-settings"], data);
      setRows(data.plugs.map((p) => ({ ...p, key: newKey() })));
      queryClient.invalidateQueries({ queryKey: ["plugs"] });
    },
  });

  const change = (key: string, patch: Partial<Row>) => {
    setSaved(false);
    setRows((current) => (current ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setTests(({ [key]: _, ...rest }) => rest);
  };

  const addRow = (host = "") => {
    setSaved(false);
    setRows((current) => [...(current ?? []), { key: newKey(), host, name: "" }]);
  };

  const test = async (row: Row) => {
    setTests((current) => ({ ...current, [row.key]: "pending" }));
    try {
      const result = await api.testPlug({
        host: row.host.trim(),
        // Test with what is typed; an empty password falls back to the stored one.
        username: username.trim(),
        ...(password ? { password } : {}),
      });
      setTests((current) => ({ ...current, [row.key]: result }));
      if (result.ok && !row.name && result.alias) change(row.key, { name: result.alias });
    } catch (e) {
      setTests((current) => ({
        ...current,
        [row.key]: { ok: false, code: "connect", error: (e as Error).message },
      }));
    }
  };

  const configuredHosts = new Set((rows ?? []).map((r) => r.host.trim()));
  const found = discover.data?.filter((d) => !configuredHosts.has(d.host)) ?? [];

  return (
    <>
      <PageHeader
        title={t("plugs.title")}
        subtitle={
          <Link to="/settings" className="inline-flex items-center gap-1.5 hover:text-foreground">
            <ArrowLeft className="size-3.5" /> {t("settings.title")}
          </Link>
        }
      />

      <form
        className="mx-auto flex max-w-[1000px] flex-col gap-4 p-4 sm:gap-6 sm:p-8"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Card>
          <CardHeader title={t("plugs.account")} description={t("plugs.accountDescription")} />
          <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t("plugs.email")}</span>
              <input
                type="email"
                autoComplete="off"
                className={inputClass}
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setSaved(false);
                }}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t("plugs.password")}</span>
              <input
                type="password"
                autoComplete="new-password"
                className={inputClass}
                placeholder={query.data?.has_password ? t("plugs.passwordStored") : ""}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setSaved(false);
                }}
              />
            </label>
          </div>
        </Card>

        <Card>
          <CardHeader
            title={t("plugs.list")}
            description={t("plugs.listDescription")}
            action={
              <Button type="button" onClick={() => discover.mutate()} disabled={discover.isPending}>
                {discover.isPending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
                {discover.isPending ? t("plugs.discovering") : t("plugs.discover")}
              </Button>
            }
          />
          <div className="flex flex-col gap-4 p-5 sm:p-6">
            {discover.isSuccess && (
              <div className="rounded-lg bg-muted-surface px-4 py-3 text-sm text-muted">
                {found.length === 0 ? (
                  t("plugs.discoverNone")
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{t("plugs.discoverFound", { count: found.length })}</span>
                    {found.map((d) => (
                      <button
                        key={d.host}
                        type="button"
                        onClick={() => addRow(d.host)}
                        className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground hover:bg-muted-surface"
                      >
                        {d.model ? `${d.model} · ` : ""}
                        {d.host}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {rows?.map((row) => {
              const result = tests[row.key];
              return (
                <div key={row.key} className="flex flex-col gap-2 border-b border-border pb-4 last:border-0 last:pb-0">
                  <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">{t("plugs.name")}</span>
                      <input
                        className={inputClass}
                        placeholder={t("plugs.namePlaceholder")}
                        value={row.name}
                        onChange={(e) => change(row.key, { name: e.target.value })}
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">{t("plugs.host")}</span>
                      <input
                        className={`${inputClass} tabular`}
                        placeholder="192.168.1.20"
                        inputMode="decimal"
                        value={row.host}
                        onChange={(e) => change(row.key, { host: e.target.value })}
                      />
                    </label>
                    <Button
                      type="button"
                      onClick={() => test(row)}
                      disabled={!row.host.trim() || result === "pending"}
                    >
                      {result === "pending" && <LoaderCircle className="size-4 animate-spin" />}
                      {t("plugs.test")}
                    </Button>
                    <Button
                      type="button"
                      aria-label={t("common.remove")}
                      onClick={() => {
                        setSaved(false);
                        setRows((current) => (current ?? []).filter((r) => r.key !== row.key));
                      }}
                      className="px-3"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  {result && result !== "pending" && (
                    <p className={`flex items-start gap-2 text-sm ${result.ok ? "text-export" : "text-import"}`}>
                      {result.ok ? (
                        <Check className="mt-0.5 size-4 shrink-0" />
                      ) : (
                        <CircleAlert className="mt-0.5 size-4 shrink-0" />
                      )}
                      {result.ok
                        ? t("plugs.testOk", {
                            model: result.model ?? "Tapo",
                            state: result.is_on ? t("plugs.on") : t("plugs.off"),
                            power: result.power != null ? ` · ${powerText(result.power)}` : "",
                          })
                        : tDynamic(`plugs.error.${result.code}`, result.error)}
                    </p>
                  )}
                </div>
              );
            })}

            <div>
              <Button type="button" onClick={() => addRow()}>
                <Plus className="size-4" /> {t("plugs.add")}
              </Button>
            </div>
          </div>
        </Card>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          {save.isError && (
            <span className="flex items-center gap-1.5 text-sm text-import sm:mr-auto">
              <CircleAlert className="size-4" /> {save.error.message}
            </span>
          )}
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-export sm:mr-auto">
              <Check className="size-4" /> {t("plugs.saved")}
            </span>
          )}
          <Button type="submit" variant="primary" disabled={save.isPending || rows === null}>
            {save.isPending && <LoaderCircle className="size-4 animate-spin" />}
            {t("plugs.save")}
          </Button>
        </div>
      </form>
    </>
  );
}
