import React from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  TimerReset,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { formatTo12Hour } from "../cartographer";
import type { SentinelEvent, StoredTask } from "../types";

export function FocusMode({
  task,
  nextStep,
  driftSignal,
  onClose,
  onStepDone,
  onStuck,
  onRunningLate,
  onFinish
}: {
  task: StoredTask;
  nextStep?: { title: string; durationMinutes: number } | null;
  driftSignal?: SentinelEvent | null;
  onClose: () => void;
  onStepDone: () => void;
  onStuck: () => void;
  onRunningLate: () => void;
  onFinish: () => void;
}) {
  const nextAction = nextStep?.title || task.nextPhysicalAction;
  const doneCount = task.steps.filter(step => step.state === "done").length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex flex-col bg-bg"
    >
      <div className="border-b border-primary/15 bg-bg/90 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-lg items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold text-primary">Focus mode</span>
        <button
          onClick={onClose}
          className="rounded-xl bg-white/[0.06] p-2 text-ink-muted hover:text-ink"
          aria-label="Close focus mode"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      </div>

      <div className="flex flex-1 flex-col justify-center overflow-y-auto px-4 py-7">
        <div className="mx-auto w-full max-w-lg space-y-5">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">One task only</p>
            <h1 className="text-2xl font-semibold leading-tight text-ink">
              {task.title}
            </h1>
            <p className="text-base leading-6 text-ink-muted"><span className="font-medium text-primary">Next:</span> {nextAction}</p>
          </div>

          <div className="glass-panel rounded-2xl p-4">
            <div className="flex items-center justify-between text-xs text-ink-muted">
              <span>{task.estimatedDurationMinutes}m target</span>
              <span className="text-primary">{doneCount}/{task.steps.length} steps</span>
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((doneCount / Math.max(1, task.steps.length)) * 100)}%` }} /></div>
            {task.targetTime && (
              <p className="mt-3 text-xs text-ink-faint">Target {formatTo12Hour(task.targetTime)}</p>
            )}
          </div>

          {driftSignal && (
            <div className="rounded-2xl border border-amber-400/25 bg-amber-300/[0.06] p-4">
              <p className="text-sm font-semibold text-amber-100">Possible distraction</p>
              <p className="mt-1 text-xs text-amber-100/70">{driftSignal.title}</p>
            </div>
          )}

          <div className="space-y-2.5">
            <button
              onClick={onStepDone}
              className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl bg-[#4ade80] px-4 py-3.5 text-left font-semibold text-[#06150b] shadow-soft disabled:opacity-45"
            >
              <Check className="h-6 w-6 shrink-0" />
              <span>
                <span className="block text-base leading-tight">Step done</span>
                <span className="mt-0.5 block text-xs opacity-75">Advance the checklist</span>
              </span>
            </button>
            <button
              onClick={onStuck}
              className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl bg-[#f6c64f] px-4 py-3.5 text-left font-semibold text-[#211500] shadow-soft"
            >
              <AlertTriangle className="h-6 w-6 shrink-0" />
              <span>
                <span className="block text-base leading-tight">I&apos;m stuck</span>
                <span className="mt-0.5 block text-xs opacity-75">Simplify next actions</span>
              </span>
            </button>
            <button
              onClick={onRunningLate}
              className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl bg-[#f16065] px-4 py-3.5 text-left font-semibold text-white shadow-soft"
            >
              <TimerReset className="h-6 w-6 shrink-0" />
              <span>
                <span className="block text-base leading-tight">Running late</span>
                <span className="mt-0.5 block text-xs opacity-75">Shrink the route</span>
              </span>
            </button>
            <button
              onClick={onFinish}
              className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.07] px-4 py-3.5 text-left font-semibold text-ink shadow-soft"
            >
              <CheckCircle2 className="h-6 w-6 shrink-0" />
              <span>
                <span className="block text-base leading-tight">Finish task</span>
                <span className="mt-0.5 block text-xs opacity-75">Mark all done</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
