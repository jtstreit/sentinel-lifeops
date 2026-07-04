import React, { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { StoredTask, TaskUrgency } from "../types";
import { TaskCard } from "./TaskCard";

type UrgencyFilter = "all" | TaskUrgency;

const urgencyRank: Record<string, number> = { now: 0, soon: 1, later: 2 };

function openOrder(a: StoredTask, b: StoredTask): number {
  const rankA = a.urgency ? urgencyRank[a.urgency] : 3;
  const rankB = b.urgency ? urgencyRank[b.urgency] : 3;
  if (rankA !== rankB) return rankA - rankB;
  if (a.targetTime && b.targetTime && a.targetTime !== b.targetTime) return a.targetTime < b.targetTime ? -1 : 1;
  if (Boolean(a.targetTime) !== Boolean(b.targetTime)) return a.targetTime ? -1 : 1;
  return b.updatedAtEpochMillis - a.updatedAtEpochMillis;
}

// The organized task list: open tasks sorted by urgency/time, done history collapsed
// below, urgency filter pills on top. Dismissed tasks are hidden entirely.
export function TaskList({
  tasks,
  fallbackWhyFor,
  isLoading,
  onToggleComplete,
  onToggleStep,
  onDismiss,
  onFocus
}: {
  tasks: StoredTask[];
  fallbackWhyFor?: (task: StoredTask) => string | undefined;
  isLoading?: boolean;
  onToggleComplete: (task: StoredTask) => void;
  onToggleStep: (task: StoredTask, stepId: string) => void;
  onDismiss: (task: StoredTask) => void;
  onFocus?: (task: StoredTask) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [filter, setFilter] = useState<UrgencyFilter>("all");
  const [showDone, setShowDone] = useState(false);

  const openTasks = useMemo(
    () => tasks
      .filter(task => task.status === "open")
      .filter(task => filter === "all" || task.urgency === filter)
      .sort(openOrder),
    [tasks, filter]
  );
  const doneTasks = useMemo(
    () => tasks
      .filter(task => task.status === "done")
      .sort((a, b) => (b.completedAtEpochMillis || b.updatedAtEpochMillis) - (a.completedAtEpochMillis || a.updatedAtEpochMillis)),
    [tasks]
  );

  const filters: Array<{ key: UrgencyFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "now", label: "Now" },
    { key: "soon", label: "Soon" },
    { key: "later", label: "Later" }
  ];

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-bold text-ink">Task list</h2>
          <p className="mt-1 text-sm text-slate-400">{openTasks.length} open, {doneTasks.length} done. Check a circle to complete.</p>
        </div>
        <div className="flex gap-1.5">
          {filters.map(item => (
            <button
              key={item.key}
              onClick={() => setFilter(item.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                filter === item.key ? "bg-primary text-primary-ink" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="mt-4 space-y-3" aria-hidden>
          {[0, 1, 2].map(row => (
            <div key={row} className="animate-pulse rounded-lg border border-slate-800 bg-slate-950/60 p-4">
              <div className="h-3 w-24 rounded bg-slate-800" />
              <div className="mt-3 h-4 w-3/4 rounded bg-slate-800" />
              <div className="mt-2 h-3 w-1/2 rounded bg-slate-800/70" />
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-3">
        <AnimatePresence initial={false} mode={reduceMotion ? "wait" : "sync"}>
          {openTasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              fallbackWhy={fallbackWhyFor?.(task)}
              onToggleComplete={onToggleComplete}
              onToggleStep={onToggleStep}
              onDismiss={onDismiss}
              onFocus={onFocus}
            />
          ))}
        </AnimatePresence>
        {openTasks.length === 0 && !isLoading && (
          <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/40 p-5">
            <h3 className="text-base font-bold text-slate-100">{filter === "all" ? "No open tasks" : `Nothing marked "${filter}"`}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              {filter === "all"
                ? "Accept a suggestion below, build cards from phone signals, or add a task manually."
                : "Switch the filter back to All to see every open task."}
            </p>
          </div>
        )}
      </div>

      {doneTasks.length > 0 && (
        <div className="mt-5 border-t border-slate-800 pt-4">
          <button
            onClick={() => setShowDone(prev => !prev)}
            className="flex items-center gap-1.5 text-sm font-bold text-slate-400 hover:text-ink"
          >
            <motion.span animate={{ rotate: showDone ? 180 : 0 }} transition={{ duration: reduceMotion ? 0 : 0.15 }}>
              <ChevronDown className="h-4 w-4" />
            </motion.span>
            Done ({doneTasks.length})
          </button>
          {showDone && (
            <div className="mt-3 space-y-3">
              <AnimatePresence initial={false}>
                {doneTasks.slice(0, 30).map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    fallbackWhy={fallbackWhyFor?.(task)}
                    onToggleComplete={onToggleComplete}
                    onToggleStep={onToggleStep}
                    onDismiss={onDismiss}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
