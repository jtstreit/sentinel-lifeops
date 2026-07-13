import React, { useState } from "react";
import { ChevronDown, Sparkles, Trash2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { StoredTask } from "../types";
import { formatTo12Hour } from "../cartographer";
import { TaskCheckbox } from "./TaskCheckbox";

const urgencyLabel: Record<string, string> = {
  now: "High",
  soon: "Medium",
  later: "Low",
};

export function TaskCard({
  task,
  fallbackWhy,
  onToggleComplete,
  onToggleStep,
  onDismiss,
  onFocus,
  onAskOpus,
  isCoaching,
}: {
  task: StoredTask;
  fallbackWhy?: string;
  onToggleComplete: (task: StoredTask) => void;
  onToggleStep: (task: StoredTask, stepId: string) => void;
  onDismiss: (task: StoredTask) => void;
  onFocus?: (task: StoredTask) => void;
  onAskOpus?: (task: StoredTask) => void;
  isCoaching?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const done = task.status === "done";
  const why = task.why || fallbackWhy;
  const doneSteps = task.steps.filter(step => step.state === "done").length;

  return (
    <motion.article
      layout={!reduceMotion}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, height: 0, overflow: "hidden" }}
      transition={{ duration: 0.18 }}
      className={`overflow-hidden rounded-2xl border ${done ? "border-white/[0.05] bg-white/[0.025]" : "border-white/[0.08] bg-white/[0.055]"}`}
    >
      <div className="flex items-start gap-3 p-3.5">
        <TaskCheckbox checked={done} label={done ? `Reopen: ${task.title}` : `Complete: ${task.title}`} onToggle={() => onToggleComplete(task)} />

        <button
          type="button"
          onClick={() => setDetailsOpen(open => !open)}
          className="min-w-0 flex-1 text-left"
          aria-expanded={detailsOpen}
        >
          <span className={`block text-[15px] font-medium leading-5 ${done ? "text-ink-faint line-through" : "text-ink"}`}>{task.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {task.urgency && <span className="font-medium text-primary">{urgencyLabel[task.urgency] || task.urgency}</span>}
            <span className="text-ink-muted">{task.estimatedDurationMinutes} min</span>
            {task.targetTime && <span className="text-ink-muted">{formatTo12Hour(task.targetTime)}</span>}
            {task.steps.length > 0 && <span className="text-ink-faint">{doneSteps}/{task.steps.length} steps</span>}
          </span>
        </button>

        <motion.span animate={{ rotate: detailsOpen ? 180 : 0 }} transition={{ duration: reduceMotion ? 0 : 0.15 }} className="mt-1 text-ink-faint">
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </div>

      {detailsOpen && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="overflow-hidden border-t border-white/[0.06] bg-black/15 px-3.5 py-3"
        >
          {!done && task.nextPhysicalAction && <p className="text-sm leading-5 text-ink-muted"><span className="font-semibold text-ink">Next:</span> {task.nextPhysicalAction}</p>}
          {why && <p className="mt-2 text-xs leading-5 text-ink-faint">{why}</p>}

          {task.steps.length > 0 && (
            <ul className="mt-3 space-y-2">
              {task.steps.map(step => (
                <li key={step.id} className="flex items-center gap-2.5">
                  <TaskCheckbox
                    checked={step.state === "done"}
                    label={`${step.state === "done" ? "Reopen" : "Complete"} step: ${step.title}`}
                    onToggle={() => onToggleStep(task, step.id)}
                  />
                  <span className={`text-sm ${step.state === "done" ? "text-ink-faint line-through" : "text-ink-muted"}`}>
                    {step.title} <span className="text-xs text-ink-faint">{step.durationMinutes}m</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {task.coachGuidance && (
            <details className="mt-3 rounded-xl border border-accent/20 bg-accent-soft/40 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-indigo-100">Saved coaching guidance</summary>
              <div className="mt-3 space-y-3 text-xs leading-5 text-ink-muted">
                <p>{task.coachGuidance.summary}</p>
                <div><span className="font-semibold text-ink">Low-energy version:</span> {task.coachGuidance.lowEnergyVersion}</div>
                {task.coachGuidance.frictionPlan.length > 0 && (
                  <div>
                    <p className="font-semibold text-ink">If something gets in the way</p>
                    {task.coachGuidance.frictionPlan.map((item, index) => (
                      <p key={`${item.friction}-${index}`} className="mt-1"><span className="font-medium text-ink">{item.friction}:</span> {item.response}</p>
                    ))}
                  </div>
                )}
                {task.coachGuidance.behavioralActivation && (
                  <div>
                    <p className="font-semibold text-ink">Momentum plan</p>
                    <p><span className="font-medium text-ink">Why:</span> {task.coachGuidance.behavioralActivation.valueLink}</p>
                    <p><span className="font-medium text-ink">Start:</span> {task.coachGuidance.behavioralActivation.gradedStart}</p>
                    <p><span className="font-medium text-ink">When:</span> {task.coachGuidance.behavioralActivation.scheduledWindow}</p>
                  </div>
                )}
                {task.coachGuidance.habitPlan && (
                  <div>
                    <p className="font-semibold text-ink">Habit plan</p>
                    <p>{task.coachGuidance.habitPlan.cue} → {task.coachGuidance.habitPlan.routine} → {task.coachGuidance.habitPlan.reward}</p>
                  </div>
                )}
                {(task.coachGuidance.model || task.coachGuidance.engine) && (
                  <p className="text-[10px] text-ink-faint">Saved from {task.coachGuidance.model || task.coachGuidance.engine}</p>
                )}
              </div>
            </details>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {!done && onFocus && (
              <button type="button" onClick={() => onFocus(task)} className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-ink">
                Do this now
              </button>
            )}
            {!done && onAskOpus && (
              <button type="button" onClick={() => onAskOpus(task)} disabled={isCoaching} className="flex items-center gap-1.5 rounded-xl border border-accent/35 bg-accent-soft px-3 py-2 text-xs font-semibold text-indigo-100 disabled:opacity-45">
                <Sparkles className="h-3.5 w-3.5" /> Ask Opus
              </button>
            )}
            <button type="button" onClick={() => onDismiss(task)} className="ml-auto flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-ink-faint hover:bg-rose-400/10 hover:text-rose-200">
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          </div>
        </motion.div>
      )}
    </motion.article>
  );
}
