import React, { useState } from "react";
import { ChevronDown, Crosshair, Trash2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { StoredTask } from "../types";
import { formatTo12Hour } from "../cartographer";
import { Pill } from "./ui";
import { TaskCheckbox } from "./TaskCheckbox";

const urgencyTone: Record<string, "danger" | "warn" | "neutral"> = {
  now: "danger",
  soon: "warn",
  later: "neutral"
};

// One row in the organized task list. The why-line is the AI's grounded reason the
// task exists; fallbackWhy carries the situation evidence when the AI did not run.
export function TaskCard({
  task,
  fallbackWhy,
  onToggleComplete,
  onToggleStep,
  onDismiss,
  onFocus
}: {
  task: StoredTask;
  fallbackWhy?: string;
  onToggleComplete: (task: StoredTask) => void;
  onToggleStep: (task: StoredTask, stepId: string) => void;
  onDismiss: (task: StoredTask) => void;
  onFocus?: (task: StoredTask) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [stepsOpen, setStepsOpen] = useState(false);
  const done = task.status === "done";
  const why = task.why || fallbackWhy;
  const doneSteps = task.steps.filter(step => step.state === "done").length;

  return (
    <motion.article
      layout={!reduceMotion}
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, height: 0, marginBottom: 0, overflow: "hidden" }}
      transition={{ duration: 0.22 }}
      className={`rounded-lg border p-4 ${done ? "border-slate-800 bg-slate-950/50" : "border-slate-700 bg-slate-900"}`}
    >
      <div className="flex items-start gap-3">
        <TaskCheckbox checked={done} label={done ? `Reopen: ${task.title}` : `Complete: ${task.title}`} size="lg" onToggle={() => onToggleComplete(task)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {task.urgency && <Pill tone={urgencyTone[task.urgency] || "neutral"}>{task.urgency}</Pill>}
            {task.targetTime && <Pill tone="warn">{formatTo12Hour(task.targetTime)}</Pill>}
            <span className="text-xs text-slate-500">{task.estimatedDurationMinutes} min</span>
          </div>
          <h3 className={`mt-1.5 text-base font-bold ${done ? "text-slate-500 line-through decoration-slate-600" : "text-ink"}`}>{task.title}</h3>
          {why && <p className={`mt-1 text-sm leading-relaxed ${done ? "text-slate-600" : "text-slate-400"}`}>{why}</p>}
          {!done && task.nextPhysicalAction && (
            <p className="mt-2 text-sm font-semibold text-cyan-200/90">Next: {task.nextPhysicalAction}</p>
          )}
          {task.steps.length > 0 && (
            <button
              onClick={() => setStepsOpen(prev => !prev)}
              className="mt-3 flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-ink"
            >
              <motion.span animate={{ rotate: stepsOpen ? 180 : 0 }} transition={{ duration: reduceMotion ? 0 : 0.15 }}>
                <ChevronDown className="h-4 w-4" />
              </motion.span>
              Steps {doneSteps}/{task.steps.length}
            </button>
          )}
          {stepsOpen && (
            <motion.ul
              initial={reduceMotion ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              transition={{ duration: 0.18 }}
              className="mt-2 space-y-2 overflow-hidden"
            >
              {task.steps.map(step => (
                <li key={step.id} className="flex items-center gap-2.5">
                  <TaskCheckbox
                    checked={step.state === "done"}
                    label={`${step.state === "done" ? "Reopen" : "Complete"} step: ${step.title}`}
                    onToggle={() => onToggleStep(task, step.id)}
                  />
                  <span className={`text-sm ${step.state === "done" ? "text-slate-500 line-through decoration-slate-600" : "text-slate-300"}`}>
                    {step.title} <span className="text-xs text-slate-600">({step.durationMinutes}m)</span>
                  </span>
                </li>
              ))}
            </motion.ul>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {!done && onFocus && (
            <button
              onClick={() => onFocus(task)}
              className="rounded-lg border border-cyan-400/30 p-2 text-cyan-200 hover:bg-cyan-950/40"
              aria-label={`Focus on: ${task.title}`}
              title="Make this the current task"
            >
              <Crosshair className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => onDismiss(task)}
            className="rounded-lg border border-slate-800 p-2 text-slate-500 hover:bg-rose-950/40 hover:text-rose-200"
            aria-label={`Dismiss: ${task.title}`}
            title="Remove from the list"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </motion.article>
  );
}
