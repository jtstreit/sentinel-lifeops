import React from "react";
import {
  Bell,
  CalendarDays,
  Check,
  MessageSquare,
  Smartphone,
  X,
  Zap,
} from "lucide-react";
import { formatTo12Hour } from "../cartographer";
import type { SmartSituation } from "../decisionEngine";
import type { ExecutiveTask } from "../types";
import { Pill } from "./ui";

function sourceIcon(source: SmartSituation["primarySignal"]["source"]) {
  if (source === "sms") return MessageSquare;
  if (source === "calendar") return CalendarDays;
  if (source === "screen_text") return Smartphone;
  if (source === "app_usage") return Smartphone;
  if (source === "location") return Zap;
  return Bell;
}

const urgencyTone: Record<string, "danger" | "warn" | "neutral"> = {
  now: "danger",
  soon: "warn",
  later: "neutral"
};

const confidenceTone: Record<string, "success" | "warn" | "danger"> = {
  high: "success",
  medium: "warn",
  low: "danger"
};

export function SmartSuggestionCard({
  task,
  situation,
  targetTime,
  onApprove,
  onDismiss,
}: {
  task: ExecutiveTask;
  situation?: SmartSituation;
  targetTime?: string | null;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const SourceIcon = situation ? sourceIcon(situation.primarySignal.source) : Bell;

  return (
    <article className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3 shadow-sm">
      <div className="mt-0.5 rounded-lg bg-cyan-400/10 p-2 text-cyan-200">
        <SourceIcon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-bold leading-tight text-ink">{task.title}</h3>
        <p className="mt-0.5 text-sm text-slate-400">{task.nextPhysicalAction}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {task.urgency && <Pill tone={urgencyTone[task.urgency] || "neutral"}>{task.urgency}</Pill>}
          {situation && <Pill tone={confidenceTone[situation.confidence] || "neutral"}>{situation.confidence}</Pill>}
          <Pill tone="neutral">{task.estimatedDurationMinutes}m</Pill>
          {targetTime && <Pill tone="warn">{formatTo12Hour(targetTime)}</Pill>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2">
        <button
          onClick={onApprove}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-slate-950 transition-colors hover:bg-emerald-400"
          aria-label={`Add to tasks: ${task.title}`}
          title="Add to tasks"
        >
          <Check className="h-5 w-5" />
        </button>
        <button
          onClick={onDismiss}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-slate-400 transition-colors hover:bg-slate-700 hover:text-ink"
          aria-label={`Dismiss: ${task.title}`}
          title="Not a task"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </article>
  );
}
