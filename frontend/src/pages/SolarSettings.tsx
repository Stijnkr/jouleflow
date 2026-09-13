import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CircleAlert, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button, Card, CardHeader, PageHeader } from "../components/ui";
import { api, type InverterConfig, type InverterTestResult } from "../lib/api";
import { energy, powerText } from "../lib/format";
import { t, tDynamic } from "../lib/i18n";

const inputClass =
  "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition placeholder:text-subtle focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10";

type Row = { key: string; id?: string; name: string; host: string; port: string; unit_id: string };

let keySeq = 0;
const newKey = () => `inv-${++keySeq}`;

const toRow = (c: InverterConfig): Row => ({
  key: newKey(),
  id: c.id,
  name: c.name,
  host: c.host,
  port: String(c.port),
  unit_id: String(c.unit_id),
});

const toConfig = (r: Row): InverterConfig => ({
  ...(r.id ? { id: r.id } : {}),
  name: r.name.trim(),
  model: "growatt",
  host: r.host.trim(),
  port: Number(r.port) || 502,
  unit_id: Number(r.unit_id) || 1,
});

export function SolarSettingsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["solar-settings"], queryFn: api.solarSettings });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [tests, setTests] = useState<Record<string, InverterTestResult | "pending">>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (query.data && rows === null) setRows(query.data.inverters.map(toRow));
  }, [query.data, rows]);

  const save = useMutation({
    mutationFn: () => api.saveSolarSettings((rows ?? []).filter((r) => r.host.trim()).map(toConfig)),
    onSuccess: (data) => {
      setSaved(true);
      queryClient.setQueryData(["solar-settings"], data);
      setRows(data.inverters.map(toRow));
      queryClient.invalidateQueries({ queryKey: ["inverters"] });
    },
  });

  const change = (key: string, patch: Partial<Row>) => {
    setSaved(false);
    setRows((current) => (current ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setTests(({ [key]: _, ...rest }) => rest);
  };

  const test = async (row: Row) => {
    setTests((current) => ({ ...current, [row.key]: "pending" }));
    const { host, port, unit_id } = toConfig(row);
    try {
      const result = await api.testInverter({ host, port, unit_id });
      setTests((current) => ({ ...current, [row.key]: result }));
    } catch (e) {
      setTests((current) => ({
        ...current,
        [row.key]: { ok: false, code: "connect", error: (e as Error).message },
      }));
    }
  };

  return (
    <>
      <PageHeader
        title={t("solar.title")}
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
          <CardHeader title={t("solar.list")} description={t("solar.listDescription")} />
          <div className="flex flex-col gap-4 p-5 sm:p-6">
            {rows?.map((row) => {
              const result = tests[row.key];
              return (
                <div key={row.key} className="flex flex-col gap-3 border-b border-border pb-4 last:border-0 last:pb-0">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">{t("solar.name")}</span>
                      <input
                        className={inputClass}
                        placeholder={t("solar.namePlaceholder")}
                        value={row.name}
                        onChange={(e) => change(row.key, { name: e.target.value })}
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">{t("solar.model")}</span>
                      <select className={inputClass} value="growatt" disabled>
                        <option value="growatt">{t("solar.modelGrowatt")}</option>
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[2fr_1fr_1fr_auto_auto]">
                    <label className="col-span-2 flex flex-col gap-2 sm:col-span-1">
                      <span className="text-sm font-medium">{t("solar.host")}</span>
                      <input
                        className={`${inputClass} tabular`}
                        placeholder="192.168.1.100"
                        inputMode="decimal"
                        value={row.host}
                        onChange={(e) => change(row.key, { host: e.target.value })}
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">{t("solar.port")}</span>
                      <input
                        className={`${inputClass} tabular`}
                        inputMode="numeric"
                        value={row.port}
                        onChange={(e) => change(row.key, { port: e.target.value.replace(/\D/g, "") })}
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">{t("solar.unitId")}</span>
                      <input
                        className={`${inputClass} tabular`}
                        inputMode="numeric"
                        value={row.unit_id}
                        onChange={(e) => change(row.key, { unit_id: e.target.value.replace(/\D/g, "") })}
                      />
                    </label>
                    <Button
                      type="button"
                      onClick={() => test(row)}
                      disabled={!row.host.trim() || result === "pending"}
                    >
                      {result === "pending" && <LoaderCircle className="size-4 animate-spin" />}
                      {t("solar.test")}
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
                        ? t("solar.testOk", {
                            power: powerText(result.power),
                            today: energy(result.today_kwh, 1),
                            total: energy(result.total_kwh, 1),
                          })
                        : tDynamic(`solar.error.${result.code}`, result.error)}
                    </p>
                  )}
                </div>
              );
            })}

            <div>
              <Button
                type="button"
                onClick={() => {
                  setSaved(false);
                  setRows((current) => [
                    ...(current ?? []),
                    { key: newKey(), name: "", host: "", port: "502", unit_id: "1" },
                  ]);
                }}
              >
                <Plus className="size-4" /> {t("solar.add")}
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
              <Check className="size-4" /> {t("solar.saved")}
            </span>
          )}
          <Button type="submit" variant="primary" disabled={save.isPending || rows === null}>
            {save.isPending && <LoaderCircle className="size-4 animate-spin" />}
            {t("solar.save")}
          </Button>
        </div>
      </form>
    </>
  );
}
