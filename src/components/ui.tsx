"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Card({
  children,
  className,
  title,
  icon,
  actions,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={cn("card rise-in", className)}>
      {title && (
        <header className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5 border-b border-line">
          <div className="flex items-center gap-2 min-w-0">
            {icon && <span className="text-ink-3 shrink-0">{icon}</span>}
            <h2 className="section-label truncate">{title}</h2>
          </div>
          {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  className,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium",
        "px-3 py-1.5 transition-all duration-150 select-none",
        "disabled:opacity-40 disabled:pointer-events-none",
        variant === "default" &&
          "bg-panel-3 text-ink hover:brightness-110 border border-line",
        variant === "primary" &&
          "bg-accent text-white hover:brightness-110 shadow-[0_2px_10px_-2px_var(--accent)]",
        variant === "danger" &&
          "bg-transparent text-critical border border-critical/40 hover:bg-critical/10",
        variant === "ghost" &&
          "bg-transparent text-ink-2 hover:text-ink hover:bg-panel-3",
        className
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex rounded-lg bg-panel-2 border border-line p-0.5 gap-0.5",
        className
      )}
      role="tablist"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded-md px-2.5 py-1 text-[12px] font-medium transition-all duration-150",
            o.value === value
              ? "bg-accent/15 text-accent shadow-[inset_0_0_0_1px_var(--accent)]"
              : "text-ink-3 hover:text-ink-2"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({
  children,
  color,
  className,
}: {
  children: ReactNode;
  color?: "good" | "warn" | "critical" | "neutral" | "accent";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border",
        color === "good" && "text-good border-good/35 bg-good/10",
        color === "warn" && "text-warn border-warn/35 bg-warn/10",
        color === "critical" && "text-critical border-critical/35 bg-critical/10",
        color === "accent" && "text-accent border-accent/35 bg-accent/10",
        (!color || color === "neutral") && "text-ink-2 border-line bg-panel-3",
        className
      )}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-ink-3">{label}</span>
      {children}
    </label>
  );
}

export const inputClass = cn(
  "w-full rounded-lg bg-panel-2 border border-line px-2.5 py-1.5 text-[13px] text-ink",
  "placeholder:text-ink-3 outline-none transition-colors",
  "focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
);
