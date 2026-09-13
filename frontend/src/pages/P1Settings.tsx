import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CircleAlert, Gauge, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button, Card, CardHeader, cn, PageHeader, StatusDot, TextField } from "../components/ui";
import { api, type DriverInfo, type P1Config, type ProbeResult } from "../lib/api";
import { powerText, time } from "../lib/format";

export function P1SettingsPage() {
  const queryClient = useQueryClient();
  const drivers = useQuery({ queryKey: ["p1-drivers"], queryFn: api.p1Drivers });
  const config = useQuery({ queryKey: ["p1-config"], queryFn: api.p1Config });
  const live = useQuery({ queryKey: ["live"], queryFn: api.live, refetchInterval: 3000 });

  const [draft, setDraft] = useState<P1Config | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [saved, setSaved] = useState(false);

  // Start editing from the saved configuration, or the first available driver.
  useEffect(() => {
    if (draft || !config.data || !drivers.data) return;
    const first = drivers.data.find((d) => d.available);
    setDraft(
      config.data.configured && config.data.driver
        ? { driver: config.data.driver, options: config.data.options }
        : { driver: first?.id ?? "", options: {} },
    );
  }, [config.data, drivers.data, draft]);

  const test = useMutation({
    mutationFn: api.p1Test,
    onMutate: () => setProbe(null),
    onSuccess: setProbe,
    onError: (e) => setProbe({ ok: false, error: e.message }),
  });

  const save = useMutation({
    mutationFn: api.p1Save,
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["p1-config"] });
      queryClient.invalidateQueries({ queryKey: ["live"] });
      queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
  });

  const selected = drivers.data?.find((d) => d.id === draft?.driver);
  const dirty =
    draft != null &&
    (!config.data?.configured ||
      draft.driver !== config.data.driver ||
      JSON.stringify(draft.options) !== JSON.stringify(config.data.options));
  const complete =
    selected != null &&
    selected.fields.every((f) => !f.required || (draft?.options[f.key] ?? "").trim() !== "");

  const update = (next: P1Config) => {
    setDraft(next);
    setProbe(null);
    setSaved(false);
    save.reset();
  };

  const device = live.data?.device;
  const connected = Boolean(device?.connected);

  return (
    <>
      <PageHeader
        title="P1 meter"
        subtitle={
          <Link to="/settings" className="inline-flex items-center gap-1.5 hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Settings
          </Link>
        }
      />

      <div className="mx-auto flex max-w-[1000px] flex-col gap-4 p-4 sm:gap-6 sm:p-8">
        <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-muted-surface">
              <Gauge className="size-5 text-import" strokeWidth={1.75} />
            </div>
            <div>
              <div className="flex items-center gap-2 text-[15px] font-semibold">
                <StatusDot ok={connected} />
                {!device || device.connection === "Not configured"
                  ? "No meter configured"
                  : connected
                    ? "Receiving data"
                    : "Not receiving data"}
              </div>
              <p className="mt-0.5 text-sm text-muted">
                {device && device.connection !== "Not configured" ? device.connection : "Choose your meter below to start collecting data"}
              </p>
            </div>
          </div>
          {live.data?.reading && (
            <div className="tabular text-sm text-muted sm:text-right">
              {powerText(Math.abs(live.data.reading.power_net))}{" "}
              {live.data.reading.power_net < 0 ? "exporting" : "importing"}
              <br />
              Last reading {time(live.data.reading.ts, true)}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Meter type" description="How Jouleflow reads your smart meter" />
          <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-3 sm:p-6">
            {drivers.data?.map((d) => (
              <DriverOption
                key={d.id}
                driver={d}
                selected={d.id === draft?.driver}
                onSelect={() => update({ driver: d.id, options: {} })}
              />
            ))}
          </div>
        </Card>

        {selected && draft && (
          <Card>
            <CardHeader title="Connection" description={selected.description} />
            <form
              className="flex flex-col gap-5 p-5 sm:p-6"
              onSubmit={(e) => {
                e.preventDefault();
                if (complete) save.mutate(draft);
              }}
            >
              {selected.fields.map((f) => (
                <TextField
                  key={f.key}
                  id={`p1-${f.key}`}
                  label={f.label}
                  help={f.help}
                  placeholder={f.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  value={draft.options[f.key] ?? ""}
                  onChange={(e) =>
                    update({ ...draft, options: { ...draft.options, [f.key]: e.target.value } })
                  }
                />
              ))}

              {(test.isPending || probe) && <ProbePanel pending={test.isPending} result={probe} />}

              {save.isError && (
                <p className="flex items-center gap-2 text-sm text-import">
                  <CircleAlert className="size-4" /> {save.error.message}
                </p>
              )}

              <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-end">
                {saved && !dirty && (
                  <span className="flex items-center gap-1.5 text-sm text-export sm:mr-auto">
                    <Check className="size-4" /> Saved. Jouleflow is now using this meter.
                  </span>
                )}
                <Button
                  type="button"
                  disabled={!complete || test.isPending}
                  onClick={() => test.mutate(draft)}
                >
                  {test.isPending && <LoaderCircle className="size-4 animate-spin" />}
                  Test connection
                </Button>
                <Button type="submit" variant="primary" disabled={!complete || !dirty || save.isPending}>
                  {save.isPending && <LoaderCircle className="size-4 animate-spin" />}
                  Save
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}

function DriverOption({
  driver,
  selected,
  onSelect,
}: {
  driver: DriverInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={!driver.available}
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-1.5 rounded-lg border p-4 text-left transition",
        selected
          ? "border-foreground/60 ring-1 ring-foreground/20"
          : "border-border hover:bg-muted-surface/60",
        !driver.available && "cursor-not-allowed border-dashed opacity-60 hover:bg-transparent",
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="text-sm font-semibold">{driver.name}</span>
        {selected ? (
          <span className="grid size-4 place-items-center rounded-full bg-foreground">
            <Check className="size-3 text-background" strokeWidth={3} />
          </span>
        ) : driver.available ? (
          <span className="size-4 rounded-full border border-border" />
        ) : (
          <span className="shrink-0 whitespace-nowrap rounded-full bg-muted-surface px-2 py-0.5 text-[11px] font-medium text-muted">
            Coming soon
          </span>
        )}
      </span>
      <span className="text-[13px] leading-snug text-muted">{driver.description}</span>
    </button>
  );
}

function ProbePanel({ pending, result }: { pending: boolean; result: ProbeResult | null }) {
  if (pending || !result) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted-surface px-4 py-3 text-sm text-muted">
        <LoaderCircle className="size-4 animate-spin" /> Connecting to your meter…
      </div>
    );
  }
  if (!result.ok) {
    return (
      <div className="flex gap-2.5 rounded-lg border border-import/30 bg-import/10 px-4 py-3 text-sm">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-import" />
        <span>{result.error}</span>
      </div>
    );
  }
  const version = result.dsmr_version?.length === 2
    ? `DSMR ${result.dsmr_version[0]}.${result.dsmr_version[1]}`
    : result.dsmr_version && `DSMR ${result.dsmr_version}`;
  const facts = [
    result.meter_id,
    version,
    result.power_net_w != null &&
      `${powerText(Math.abs(result.power_net_w))} ${result.power_net_w < 0 ? "exporting" : "importing"} now`,
    result.has_gas ? "Gas meter found" : null,
  ].filter(Boolean);
  return (
    <div className="flex gap-2.5 rounded-lg border border-export/30 bg-export/10 px-4 py-3 text-sm">
      <Check className="mt-0.5 size-4 shrink-0 text-export" />
      <div>
        <div className="font-medium">Connected to your meter</div>
        <div className="tabular mt-0.5 text-muted">{facts.join(" · ")}</div>
      </div>
    </div>
  );
}
