import type { ComponentType, ReactNode } from "react";

// Shared presentational primitives for the LifeOps cockpit.
// Pure props-in / JSX-out — no app state, no telemetry. They pull from the
// semantic design tokens defined in index.css so the look is tuned in one place.

/** Standard bordered surface panel — the default section container. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface p-5 ${className}`}>{children}</section>;
}

/** Section intro: a small colored kicker over a heading and optional sub-line. */
export function SectionIntro({
  kicker,
  kickerClass = "text-primary",
  title,
  children
}: {
  kicker?: string;
  kickerClass?: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="max-w-2xl">
      {kicker && <p className={`text-sm font-semibold ${kickerClass}`}>{kicker}</p>}
      <h2 className="mt-2 text-2xl font-bold leading-tight text-ink">{title}</h2>
      {children && <p className="mt-3 text-base leading-relaxed text-ink-muted">{children}</p>}
    </div>
  );
}

/** Compact metric tile: muted uppercase label above, prominent value below. */
export function StatTile({ label, value, accent = false }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface-alt px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent ? "text-primary" : "text-ink"}`}>{value}</p>
    </div>
  );
}

/** Icon-headed card used in summary grids. */
export function InfoCard({
  icon: Icon,
  title,
  iconClass = "text-primary",
  children
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  iconClass?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Icon className={`h-5 w-5 ${iconClass}`} aria-hidden="true" /> {title}
      </h3>
      <div className="mt-4">{children}</div>
    </div>
  );
}

/** Small status pill. */
export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "primary" | "success" | "warn" | "danger" }) {
  const tones: Record<string, string> = {
    neutral: "bg-surface-raised text-ink-muted",
    primary: "bg-primary-soft text-primary",
    success: "bg-emerald-950 text-emerald-200",
    warn: "bg-amber-950 text-amber-200",
    danger: "bg-rose-950 text-rose-200"
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}
