import React from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  TimerReset,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
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
      className="fixed inset-0 z-50 flex flex-col bg-slate-950"
    >
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <span className="text-sm font-bold text-cyan-200">Focus</span>
        <button
          onClick={onClose}
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-900 hover:text-ink"
          aria-label="Close focus mode"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col justify-center px-6 py-8">
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold leading-tight text-ink md:text-4xl">
              {task.title}
            </h1>
            <p className="text-lg text-cyan-200/90">{nextAction}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
            {task.targetTime && (
              <span className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
                Target: <span className="font-bold text-ink">{formatTo12Hour(task.targetTime)}</span>
              </span>
            )}
            <span className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
              Estimated: <span className="font-bold text-ink">{task.estimatedDurationMinutes}m</span>
            </span>
            <span className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
              Steps: <span className="font-bold text-ink">{doneCount}/{task.steps.length}</span>
            </span>
          </div>

          {driftSignal && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-950/20 p-4">
              <p className="text-sm font-bold text-amber-200">Possible phone drift</p>
              <p className="mt-1 text-sm text-amber-100/80">{driftSignal.title}</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={onStepDone}
              className="flex min-h-[72px] items-center gap-3 rounded-xl bg-emerald-500 px-4 py-4 text-left font-semibold text-slate-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Check className="h-6 w-6 shrink-0" />
              <span>
                <span className="block text-base leading-tight">Step done</span>
                <span className="mt-0.5 block text-xs opacity-75">Advance the checklist</span>
              </span>
            </button>
            <button
              onClick={onStuck}
              className="flex min-h-[72px] items-center gap-3 rounded-xl bg-amber-400 px-4 py-4 text-left font-semibold text-slate-950 transition-colors hover:bg-amber-300"
            >
              <AlertTriangle className="h-6 w-6 shrink-0" />
              <span>
                <span className="block text-base leading-tight">I&apos;m stuck</span>
                <span className="mt-0.5 block text-xs opacity-75">Simplify next actions</span>
              </span>
            </button>
            <button
              onClick={onRunningLate}
              className="flex min-h-[72px] items-center gap-3 rounded-xl bg-rose-500 px-4 py-4 text-left font-semibold text-slate-950 transition-colors hover:bg-rose-400"
            >
              <TimerReset className="h-6 w-6 shrink-0" />
              <span>
                <span className="block text-base leading-tight">Running late</span>
                <span className="mt-0.5 block text-xs opacity-75">Shrink the route</span>
              </span>
            </button>
            <button
              onClick={onFinish}
              className="flex min-h-[72px] items-center gap-3 rounded-xl border border-slate-700 bg-slate-800 px-4 py-4 text-left font-semibold text-ink transition-colors hover:bg-slate-700"
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
