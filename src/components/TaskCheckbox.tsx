import React from "react";
import { Check } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

// Shared animated checkmark for tasks and steps. The spring pop only plays when
// checking (not unchecking) so completing something feels like an event.
export function TaskCheckbox({
  checked,
  label,
  size = "md",
  onToggle
}: {
  checked: boolean;
  label: string;
  size?: "md" | "lg";
  onToggle: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const box = size === "lg" ? "h-8 w-8" : "h-6 w-6";
  const icon = size === "lg" ? "h-5 w-5" : "h-4 w-4";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={`flex ${box} shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
        checked ? "border-emerald-400 bg-emerald-500 text-slate-950" : "border-slate-600 bg-slate-950/60 text-transparent hover:border-emerald-400/70"
      }`}
    >
      <motion.span
        initial={false}
        animate={checked ? { scale: [reduceMotion ? 1 : 0.4, reduceMotion ? 1 : 1.25, 1], opacity: 1 } : { scale: 0.6, opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.28, times: [0, 0.7, 1] }}
        className="flex items-center justify-center"
      >
        <Check className={icon} strokeWidth={3.5} />
      </motion.span>
    </button>
  );
}
