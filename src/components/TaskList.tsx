import React, { useMemo, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
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
  onFocus,
  onAskOpus,
  onAdd,
  isCoaching,
}: {
  tasks: StoredTask[];
  fallbackWhyFor?: (task: StoredTask) => string | undefined;
  isLoading?: boolean;
  onToggleComplete: (task: StoredTask) => void;
  onToggleStep: (task: StoredTask, stepId: string) => void;
  onDismiss: (task: StoredTask) => void;
  onFocus?: (task: StoredTask) => void;
  onAskOpus?: (task: StoredTask) => void;
  onAdd?: () => void;
  isCoaching?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [filter, setFilter] = useState<UrgencyFilter>("all");
  const [showDone, setShowDone] = useState(false);

  const allOpenTasks = useMemo(
    () => tasks
      .filter(task => task.status === "open")
      .sort(openOrder),
    [tasks]
  );
  const openTasks = useMemo(
    () => allOpenTasks.filter(task => filter === "all" || task.urgency === filter),
    [allOpenTasks, filter]
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
    <section>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[18px] font-semibold text-ink">Task list <span className="font-normal text-ink-faint">· {allOpenTasks.length} open, {doneTasks.length} done</span></h2>
        {onAdd && (
          <button type="button" onClick={onAdd} className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-ink">
            <Plus className="h-4 w-4" /> Add
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
          {filters.map(item => (
            <button
              key={item.key}
              onClick={() => setFilter(item.key)}
              className={`rounded-full px-2 py-2 text-xs font-semibold transition-colors ${
                filter === item.key ? "bg-primary text-primary-ink" : "border border-white/[0.07] bg-white/[0.05] text-ink-muted hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
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

      <div className="mt-3 space-y-2.5">
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
              onAskOpus={onAskOpus}
              isCoaching={isCoaching}
            />
          ))}
        </AnimatePresence>
        {openTasks.length === 0 && !isLoading && (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.025] p-5">
            <h3 className="text-sm font-semibold text-ink">{filter === "all" ? "No open tasks" : `Nothing marked “${filter}”`}</h3>
            <p className="mt-1.5 text-xs leading-5 text-ink-muted">
              {filter === "all"
                ? "Accept a suggestion below, build cards from phone signals, or add a task manually."
                : "Switch the filter back to All to see every open task."}
            </p>
          </div>
        )}
      </div>

      {doneTasks.length > 0 && (
        <div className="mt-5 border-t border-white/[0.07] pt-4">
          <button
            onClick={() => setShowDone(prev => !prev)}
            className="flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink"
          >
            <motion.span animate={{ rotate: showDone ? 180 : 0 }} transition={{ duration: reduceMotion ? 0 : 0.15 }}>
              <ChevronDown className="h-4 w-4" />
            </motion.span>
            Done ({doneTasks.length})
          </button>
          {showDone && (
            <div className="mt-3 space-y-2.5">
              <AnimatePresence initial={false}>
                {doneTasks.slice(0, 30).map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    fallbackWhy={fallbackWhyFor?.(task)}
                    onToggleComplete={onToggleComplete}
                    onToggleStep={onToggleStep}
                    onDismiss={onDismiss}
                    onAskOpus={onAskOpus}
                    isCoaching={isCoaching}
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
