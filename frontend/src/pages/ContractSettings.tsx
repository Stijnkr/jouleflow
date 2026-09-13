import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CircleAlert, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Button, Card, CardHeader, cn, PageHeader, Segmented } from "../components/ui";
import { api, type Contract, type TariffSettings } from "../lib/api";
import { isoDate, isoToDate, num } from "../lib/format";
import { t } from "../lib/i18n";

function newContract(): Contract {
  return {
    name: "",
    start: isoDate(new Date()),
    end: null,
    meter: "dual",
    supply_single: 0,
    supply_normal: 0,
    supply_low: 0,
    energy_tax: 0,
    surcharge: 0,
    normal_start_hour: 7,
    normal_end_hour: 23,
    netting_until: "2027-01-01",
    feed_in: [],
    fixed_supply_month: 0,
    grid_day: 0,
    tax_reduction_day: 0,
    gas_enabled: false,
    gas_price: 0,
    gas_fixed_month: 0,
    gas_grid_day: 0,
  };
}

const HOURS_PRESETS = [
  { value: "7-21", label: "07:00–21:00", hint: "contract.hoursBrabant" },
  { value: "7-23", label: "07:00–23:00", hint: "contract.hoursRest" },
] as const;

export function ContractSettingsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["tariffs"], queryFn: api.tariffs });
  const [draft, setDraft] = useState<TariffSettings | null>(null);
  const [index, setIndex] = useState(0);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (query.data && !draft) {
      const contracts = query.data.contracts.length ? query.data.contracts : [newContract()];
      setDraft({ contracts });
      setIndex(contracts.length - 1);
    }
  }, [query.data, draft]);

  const save = useMutation({
    mutationFn: api.saveTariffs,
    onSuccess: (data) => {
      setSaved(true);
      queryClient.setQueryData(["tariffs"], data);
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["history"] });
    },
  });

  if (!draft) return <PageHeader title={t("contract.title")} />;

  const contract = draft.contracts[index];
  const dirty = JSON.stringify(draft) !== JSON.stringify(query.data);

  const update = (patch: Partial<Contract>) => {
    setSaved(false);
    save.reset();
    setDraft({
      contracts: draft.contracts.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    });
  };

  const addContract = () => {
    const previous = draft.contracts[draft.contracts.length - 1];
    const next = previous
      ? { ...previous, name: "", start: previous.end ?? isoDate(new Date()), end: null }
      : newContract();
    setDraft({ contracts: [...draft.contracts, next] });
    setIndex(draft.contracts.length);
    setSaved(false);
  };

  const removeContract = () => {
    const contracts = draft.contracts.filter((_, i) => i !== index);
    setDraft({ contracts });
    setIndex(Math.max(0, contracts.length - 1));
    setSaved(false);
  };

  const priceNormal =
    (contract.meter === "single" ? contract.supply_single : contract.supply_normal) +
    contract.energy_tax +
    contract.surcharge;
  const priceLow =
    (contract.meter === "single" ? contract.supply_single : contract.supply_low) +
    contract.energy_tax +
    contract.surcharge;
  const hoursPreset = `${contract.normal_start_hour}-${contract.normal_end_hour}`;

  return (
    <>
      <PageHeader
        title={t("contract.title")}
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
          save.mutate(draft);
        }}
      >
        <p className="text-sm text-muted">
          {t("contract.intro")}
        </p>

        {/* Contract list */}
        <Card>
          <CardHeader
            title={t("contract.contracts")}
            description={t("contract.contractsDescription")}
          />
          <div className="flex flex-wrap items-center gap-2 p-5 sm:p-6">
            {draft.contracts.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIndex(i)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left text-sm transition",
                  i === index
                    ? "border-foreground/60 ring-1 ring-foreground/20"
                    : "border-border text-muted hover:bg-muted-surface",
                )}
              >
                <div className="font-medium text-foreground">{c.name || t("contract.unnamed")}</div>
                <div className="tabular text-xs text-muted">
                  {isoToDate(c.start)} → {c.end ? isoToDate(c.end) : t("contract.noEnd")}
                </div>
              </button>
            ))}
            <Button type="button" onClick={addContract} className="h-auto self-stretch">
              <Plus className="size-4" /> {t("contract.new")}
            </Button>
          </div>
        </Card>

        {/* Details */}
        <Section
          title={t("contract.section")}
          action={
            draft.contracts.length > 1 && (
              <Button type="button" onClick={removeContract} className="text-import">
                <Trash2 className="size-4" /> {t("common.remove")}
              </Button>
            )
          }
        >
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label={t("contract.supplier")}>
              <input
                className={inputClass}
                placeholder={t("contract.supplierPlaceholder")}
                value={contract.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </Field>
            <Field label={t("contract.start")}>
              <input
                type="date"
                required
                className={inputClass}
                value={contract.start}
                onChange={(e) => update({ start: e.target.value })}
              />
            </Field>
            <Field label={t("contract.end")} help={t("contract.endHelp")}>
              <input
                type="date"
                className={inputClass}
                value={contract.end ?? ""}
                onChange={(e) => update({ end: e.target.value || null })}
              />
            </Field>
          </div>
        </Section>

        <Section title={t("contract.rates")} description={t("contract.ratesDescription")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted">{t("contract.meterRates")}</span>
            <Segmented
              value={contract.meter}
              onChange={(meter) => update({ meter })}
              options={[
                { value: "dual", label: t("contract.dual") },
                { value: "single", label: t("contract.single") },
              ]}
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            {contract.meter === "dual" ? (
              <>
                <Money label={t("contract.supplyNormal")} unit="€/kWh" value={contract.supply_normal} onChange={(v) => update({ supply_normal: v })} />
                <Money label={t("contract.supplyLow")} unit="€/kWh" value={contract.supply_low} onChange={(v) => update({ supply_low: v })} />
              </>
            ) : (
              <Money label={t("contract.supply")} unit="€/kWh" value={contract.supply_single} onChange={(v) => update({ supply_single: v })} />
            )}
            <Money label={t("contract.energyTax")} unit="€/kWh" value={contract.energy_tax} onChange={(v) => update({ energy_tax: v })} />
            <Money
              label={t("contract.surcharge")}
              unit="€/kWh"
              help={t("contract.surchargeHelp")}
              value={contract.surcharge}
              onChange={(v) => update({ surcharge: v })}
            />
          </div>
          <div className="tabular rounded-lg bg-muted-surface px-4 py-3 text-sm">
            {contract.meter === "dual" ? (
              t("contract.totalDual", { normal: `€${num(priceNormal, 4)}`, low: `€${num(priceLow, 4)}` })
            ) : (
              t("contract.totalSingle", { price: `€${num(priceNormal, 4)}` })
            )}
          </div>

          {contract.meter === "dual" && (
            <div className="flex flex-col gap-3 border-t border-border pt-5">
              <span className="text-sm font-medium">{t("contract.normalHours")}</span>
              <div className="grid gap-3 sm:grid-cols-3">
                {HOURS_PRESETS.map((p) => {
                  const [s, e] = p.value.split("-").map(Number);
                  const active = hoursPreset === p.value;
                  return (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => update({ normal_start_hour: s, normal_end_hour: e })}
                      className={cn(
                        "rounded-lg border p-3 text-left text-sm transition",
                        active ? "border-foreground/60 ring-1 ring-foreground/20" : "border-border hover:bg-muted-surface",
                      )}
                    >
                      <div className="tabular font-medium">{p.label}</div>
                      <div className="text-xs text-muted">{t(p.hint)}</div>
                    </button>
                  );
                })}
                <div className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm">
                  <span className="text-muted">{t("contract.custom")}</span>
                  <input type="number" min={0} max={23} className={cn(inputClass, "h-8 w-16")} value={contract.normal_start_hour} onChange={(e) => update({ normal_start_hour: Number(e.target.value) })} />
                  –
                  <input type="number" min={1} max={24} className={cn(inputClass, "h-8 w-16")} value={contract.normal_end_hour} onChange={(e) => update({ normal_end_hour: Number(e.target.value) })} />
                </div>
              </div>
              <p className="text-[13px] text-muted">{t("contract.weekendLow")}</p>
            </div>
          )}
        </Section>

        <Section title={t("contract.feedIn")} description={t("contract.feedInDescription")}>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-current"
              checked={contract.netting_until !== null}
              onChange={(e) => update({ netting_until: e.target.checked ? "2027-01-01" : null })}
            />
            <span>
              <span className="font-medium">{t("contract.netting")}</span>
              <span className="block text-muted">{t("contract.nettingHelp")}</span>
            </span>
          </label>
          {contract.netting_until !== null && (
            <div className="sm:w-1/3">
              <Field label={t("contract.nettingUntil")}>
                <input
                  type="date"
                  className={inputClass}
                  value={contract.netting_until}
                  onChange={(e) => update({ netting_until: e.target.value || null })}
                />
              </Field>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-border pt-5">
            <div>
              <span className="text-sm font-medium">{t("contract.feedInRates")}</span>
              <p className="text-[13px] text-muted">{t("contract.feedInHelp")}</p>
            </div>
            {contract.feed_in.map((p, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <Field label={t("contract.from")}>
                  <input type="date" className={inputClass} value={p.start} onChange={(e) => update({ feed_in: contract.feed_in.map((q, j) => (j === i ? { ...q, start: e.target.value } : q)) })} />
                </Field>
                <Money label={t("contract.compensation")} unit="€/kWh" value={p.compensation} onChange={(v) => update({ feed_in: contract.feed_in.map((q, j) => (j === i ? { ...q, compensation: v } : q)) })} />
                <Money label={t("contract.feedInCost")} unit="€/kWh" value={p.cost} onChange={(v) => update({ feed_in: contract.feed_in.map((q, j) => (j === i ? { ...q, cost: v } : q)) })} />
                <Button type="button" aria-label={t("contract.removeRow")} onClick={() => update({ feed_in: contract.feed_in.filter((_, j) => j !== i) })} className="col-start-2 row-start-1 px-3 sm:col-start-auto sm:row-start-auto">
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                onClick={() =>
                  update({
                    feed_in: [
                      ...contract.feed_in,
                      { start: contract.feed_in.at(-1)?.start ?? contract.start, compensation: 0, cost: 0 },
                    ],
                  })
                }
              >
                <Plus className="size-4" /> {t("contract.addFeedIn")}
              </Button>
            </div>
          </div>
        </Section>

        <Section title={t("contract.fixed")} description={t("contract.fixedDescription")}>
          <div className="grid gap-5 sm:grid-cols-3">
            <Money label={t("contract.fixedSupply")} unit={t("unit.perMonth")} value={contract.fixed_supply_month} onChange={(v) => update({ fixed_supply_month: v })} />
            <Money label={t("contract.grid")} unit={t("unit.perDay")} value={contract.grid_day} onChange={(v) => update({ grid_day: v })} />
            <Money
              label={t("contract.taxReduction")}
              unit={t("unit.perDay")}
              help={t("contract.taxReductionHelp")}
              value={contract.tax_reduction_day}
              onChange={(v) => update({ tax_reduction_day: v })}
            />
          </div>
        </Section>

        <Section title={t("contract.gas")}>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={contract.gas_enabled}
              onChange={(e) => update({ gas_enabled: e.target.checked })}
            />
            <span className="font-medium">{t("contract.gasEnabled")}</span>
          </label>
          {contract.gas_enabled && (
            <div className="grid gap-5 sm:grid-cols-3">
              <Money label={t("contract.gasPrice")} unit="€/m³" help={t("contract.gasPriceHelp")} value={contract.gas_price} onChange={(v) => update({ gas_price: v })} />
              <Money label={t("contract.fixedSupply")} unit={t("unit.perMonth")} value={contract.gas_fixed_month} onChange={(v) => update({ gas_fixed_month: v })} />
              <Money label={t("contract.grid")} unit={t("unit.perDay")} value={contract.gas_grid_day} onChange={(v) => update({ gas_grid_day: v })} />
            </div>
          )}
        </Section>

        <div className="sticky bottom-20 z-10 flex flex-col-reverse gap-3 rounded-lg border border-border bg-card/95 p-4 backdrop-blur sm:flex-row sm:items-center sm:justify-end lg:bottom-4">
          {save.isError && (
            <span className="flex items-center gap-1.5 text-sm text-import sm:mr-auto">
              <CircleAlert className="size-4" /> {save.error.message}
            </span>
          )}
          {saved && !dirty && (
            <span className="flex items-center gap-1.5 text-sm text-export sm:mr-auto">
              <Check className="size-4" /> {t("contract.saved")}
            </span>
          )}
          {!saved && dirty && <span className="text-sm text-muted sm:mr-auto">{t("contract.unsaved")}</span>}
          <Button type="submit" variant="primary" disabled={!dirty || save.isPending}>
            {save.isPending && <LoaderCircle className="size-4 animate-spin" />}
            {t("contract.save")}
          </Button>
        </div>
      </form>
    </>
  );
}

const inputClass =
  "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition placeholder:text-subtle focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10";

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} action={action} />
      <div className="flex flex-col gap-5 p-5 sm:p-6">{children}</div>
    </Card>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {help && <span className="text-[13px] text-muted">{help}</span>}
    </label>
  );
}

function Money({
  label,
  unit,
  help,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  help?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const show = (v: number) => (v ? String(v).replace(".", decimalSeparator()) : "");
  const [text, setText] = useState(() => show(value));
  useEffect(() => {
    // Keep in sync when switching contracts, without fighting the user's typing.
    if (Number(text.replace(",", ".")) !== value) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Field label={label} help={help}>
      <div className="relative">
        <input
          inputMode="decimal"
          className={cn(inputClass, "tabular pr-16")}
          placeholder={`0${decimalSeparator()}000000`}
          value={text}
          onChange={(e) => {
            const raw = e.target.value;
            if (!/^-?\d*[.,]?\d*$/.test(raw)) return;
            setText(raw);
            const n = Number(raw.replace(",", "."));
            onChange(Number.isFinite(n) ? n : 0);
          }}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-subtle">
          {unit}
        </span>
      </div>
    </Field>
  );
}

function decimalSeparator(): string {
  return num(1.5, 1).includes(",") ? "," : ".";
}
