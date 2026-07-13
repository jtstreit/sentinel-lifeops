import { describe, expect, it } from "vitest";
import { buildAppliedCoachChanges, type TaskCoachPlan } from "./appliedCoachPlan";

const plan: TaskCoachPlan = {
  summary: "Make the call easier to begin.",
  firstStep: "Open Mom's contact",
  chunks: [
    { title: "Write one question", minutes: 2 },
    { title: "Open Mom's contact.", minutes: 1 },
    { title: "Write one question", minutes: 4 },
    { title: "Call Mom", minutes: 5 },
  ],
  lowEnergyVersion: "Send a short text asking when to call.",
  frictionPlan: [{ friction: "Unsure what to say", response: "Use the saved question." }],
  habitPlan: { cue: "After lunch", routine: "Check missed calls", reward: "Clear the badge" },
  behavioralActivation: { valueLink: "Stay connected", gradedStart: "Open Contacts", scheduledWindow: "1:00-1:10 PM" },
  engine: "claude-sdk",
  model: "claude-opus-test",
};

describe("applied coach plans", () => {
  it("puts firstStep first and deduplicates it and repeated chunks", () => {
    const changes = buildAppliedCoachChanges(plan, 1234);

    expect(changes.nextPhysicalAction).toBe("Open Mom's contact");
    expect(changes.steps.map(step => step.title)).toEqual(["Open Mom's contact", "Write one question", "Call Mom"]);
    expect(changes.steps.map(step => step.state)).toEqual(["current", "pending", "pending"]);
    expect(changes.steps[0].durationMinutes).toBe(1);
  });

  it("keeps the non-checklist guidance and provenance on the applied task change", () => {
    const changes = buildAppliedCoachChanges(plan, 1234);

    expect(changes.coachGuidance).toMatchObject({
      lowEnergyVersion: "Send a short text asking when to call.",
      frictionPlan: plan.frictionPlan,
      habitPlan: plan.habitPlan,
      behavioralActivation: plan.behavioralActivation,
      generatedAtEpochMillis: 1234,
      engine: "claude-sdk",
      model: "claude-opus-test",
    });
  });
});
