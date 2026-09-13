import type { ReactNode } from "react";

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn("rounded-lg border border-border bg-card", className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="tablist"
      className="inline-flex rounded-lg border border-border bg-muted-surface/60 p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md font-medium transition-colors",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
            o.value === value
              ? "bg-card text-foreground shadow-sm ring-1 ring-border"
              : "text-muted hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function IconButton({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-10 place-items-center rounded-lg border border-border text-muted transition-colors hover:bg-muted-surface hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function Value({
  value,
  unit,
  className,
}: {
  value: ReactNode;
  unit?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("tabular flex items-baseline gap-1.5", className)}>
      <span className="text-4xl font-semibold tracking-tight sm:text-[44px]">{value}</span>
      {unit && <span className="text-lg text-muted">{unit}</span>}
    </div>
  );
}

export function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className="relative flex size-2">
      {ok && (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-export opacity-40" />
      )}
      <span className={cn("relative inline-flex size-2 rounded-full", ok ? "bg-export" : "bg-import")} />
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-5 sm:px-8 sm:py-6">
      <div className="min-w-[12rem] flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="tabular mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

const buttonStyles = {
  primary: "bg-foreground text-background hover:opacity-90",
  secondary: "border border-border text-foreground hover:bg-muted-surface",
};

export function Button({
  variant = "secondary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonStyles }) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition disabled:pointer-events-none disabled:opacity-40",
        buttonStyles[variant],
        className,
      )}
    />
  );
}

export function TextField({
  id,
  label,
  help,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; help?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        {...props}
        className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none transition placeholder:text-subtle focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
      />
      {help && <p className="text-[13px] text-muted">{help}</p>}
    </div>
  );
}

export function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className="tabular text-right font-medium">{value}</span>
    </div>
  );
}
