import React, { useState } from "react";
import {
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  MessageSquare,
  Smartphone,
  X,
  Zap,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { formatTo12Hour } from "../cartographer";
import type { SmartSituation } from "../decisionEngine";
import { cleanSignalFragment } from "../lifeopsRules";
import type { ExecutiveTask, SentinelEvent, SentinelSource } from "../types";

function sourceIcon(source: SentinelSource) {
  if (source === "sms") return MessageSquare;
  if (source === "calendar") return CalendarDays;
  if (source === "screen_text" || source === "app_usage") return Smartphone;
  if (source === "location") return Zap;
  return Bell;
}

const urgencyLabel: Record<string, string> = {
  now: "High",
  soon: "Medium",
  later: "Low",
};

export function SmartSuggestionCard({
  task,
  situation,
  sourceSignal,
  targetTime,
  onApprove,
  onDismiss,
}: {
  task: ExecutiveTask;
  situation?: SmartSituation;
  sourceSignal?: SentinelEvent;
  targetTime?: string | null;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [contextOpen, setContextOpen] = useState(false);
  const originalSignal = situation?.primarySignal || sourceSignal;
  const SourceIcon = originalSignal ? sourceIcon(originalSignal.source) : Bell;
  const sourceText = originalSignal
    ? cleanSignalFragment(originalSignal.content || originalSignal.title, 320)
    : "No original phone context is available for this suggestion.";

  return (
    <article className="glass-panel overflow-hidden rounded-2xl">
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <SourceIcon className="h-[18px] w-[18px]" aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-5 text-ink">{task.title}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="rounded-full border border-primary/30 px-2.5 py-0.5 font-medium text-primary">
              {urgencyLabel[task.urgency || "soon"] || "Medium"}
            </span>
            <span className="text-ink-muted">{task.estimatedDurationMinutes} min</span>
            {targetTime && <span className="text-ink-muted">by {formatTo12Hour(targetTime)}</span>}
          </div>
        </div>

        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={onApprove}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-ink shadow-[0_0_20px_rgb(20_240_201_/_0.22)] transition-transform active:scale-95"
            aria-label={`Add to tasks: ${task.title}`}
            title="Add task"
          >
            <Check className="h-[18px] w-[18px]" strokeWidth={3} />
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-ink-muted transition-colors hover:bg-rose-400/15 hover:text-rose-200"
            aria-label={`Dismiss: ${task.title}`}
            title="Not a task"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setContextOpen(open => !open)}
        className="flex w-full items-center justify-between border-t border-white/[0.06] px-4 py-3 text-left text-xs text-ink-muted transition-colors hover:bg-white/[0.03] hover:text-ink"
        aria-expanded={contextOpen}
      >
        <span>{contextOpen ? "Hide phone context" : "Show phone context"}</span>
        <motion.span animate={{ rotate: contextOpen ? 180 : 0 }} transition={{ duration: reduceMotion ? 0 : 0.16 }}>
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>

      {contextOpen && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="overflow-hidden border-t border-white/[0.06] bg-black/15 px-4 py-3"
        >
          <p className="text-xs leading-5 text-ink-muted">{sourceText}</p>
          <p className="mt-2 text-xs leading-5 text-ink-faint"><span className="font-semibold text-ink-muted">Next:</span> {task.nextPhysicalAction}</p>
        </motion.div>
      )}
    </article>
  );
}
