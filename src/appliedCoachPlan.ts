import type { AppliedCoachGuidance, ExecutiveStep } from "./types";
import { cleanSignalFragment } from "./lifeopsRules";

export type TaskCoachPlan = {
  summary: string;
  firstStep: string;
  chunks: Array<{ title: string; minutes: number }>;
  lowEnergyVersion: string;
  frictionPlan: Array<{ friction: string; response: string }>;
  habitPlan?: { cue: string; routine: string; reward: string } | null;
  behavioralActivation?: { valueLink: string; gradedStart: string; scheduledWindow: string } | null;
  engine?: string;
  model?: string;
  mode?: string;
};

function stepKey(value: string) {
  return cleanSignalFragment(value, 180).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function buildAppliedCoachChanges(plan: TaskCoachPlan, now = Date.now()): {
  nextPhysicalAction: string;
  estimatedDurationMinutes: number;
  steps: ExecutiveStep[];
  coachGuidance: AppliedCoachGuidance;
} {
  const firstStepTitle = cleanSignalFragment(plan.firstStep, 160);
  const firstStepKey = stepKey(firstStepTitle);
  const matchingChunk = plan.chunks.find(chunk => stepKey(chunk.title) === firstStepKey);
  const seen = new Set([firstStepKey]);
  const orderedChunks = [{ title: firstStepTitle, minutes: matchingChunk?.minutes || 3 }];

  for (const chunk of plan.chunks) {
    const key = stepKey(chunk.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    orderedChunks.push(chunk);
    if (orderedChunks.length >= 6) break;
  }

  const steps = orderedChunks.map((chunk, index) => ({
    id: `opus-step-${now}-${index}`,
    title: cleanSignalFragment(chunk.title, 90),
    durationMinutes: Math.max(1, Math.round(chunk.minutes || 5)),
    state: index === 0 ? "current" as const : "pending" as const,
  }));

  return {
    nextPhysicalAction: firstStepTitle,
    estimatedDurationMinutes: Math.max(5, steps.reduce((total, step) => total + step.durationMinutes, 0)),
    steps,
    coachGuidance: {
      summary: plan.summary,
      lowEnergyVersion: plan.lowEnergyVersion,
      frictionPlan: plan.frictionPlan,
      habitPlan: plan.habitPlan || null,
      behavioralActivation: plan.behavioralActivation || null,
      generatedAtEpochMillis: now,
      engine: plan.engine,
      model: plan.model,
    },
  };
}
