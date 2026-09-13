import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type Plug } from "../lib/api";
import { t } from "../lib/i18n";
import { cn } from "./ui";

/** On/off switch for a smart plug. Turning off asks for a second tap, so a boiler or
 * freezer isn't switched off by accident. */
export function PlugSwitch({ plug }: { plug: Plug }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const toggle = useMutation({
    mutationFn: (on: boolean) => api.setPlugPower(plug.id, on),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plugs"] }),
  });

  const on = Boolean(plug.is_on);
  const disabled = !plug.connected || toggle.isPending;

  return (
    <div className="flex items-center gap-2">
      {confirming && <span className="text-xs text-import">{t("plugs.confirmOff")}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={on ? t("plugs.turnOff") : t("plugs.turnOn")}
        title={on ? t("plugs.turnOff") : t("plugs.turnOn")}
        disabled={disabled}
        onClick={() => {
          if (on && !confirming) return setConfirming(true);
          setConfirming(false);
          toggle.mutate(!on);
        }}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-40",
          on ? "bg-export" : "bg-muted-surface ring-1 ring-border",
          confirming && "ring-2 ring-import",
        )}
      >
        <span
          className={cn(
            "grid size-5 place-items-center rounded-full bg-white shadow transition",
            on ? "translate-x-5.5" : "translate-x-0.5",
          )}
        >
          {toggle.isPending && <LoaderCircle className="size-3 animate-spin text-black/60" />}
        </span>
      </button>
    </div>
  );
}
