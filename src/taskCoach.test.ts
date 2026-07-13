import { describe, expect, it } from "vitest";
import { taskCoachPlanSchema, taskCoachRequestSchema } from "./taskCoach";

describe("task coach contracts", () => {
  it("accepts the compact task payload sent by LifeOps", () => {
    const result = taskCoachRequestSchema.safeParse({
      task: {
        id: "task-1",
        title: "Call Mom back",
        targetTime: null,
        avoidanceTarget: "Putting off the call",
        nextPhysicalAction: "Open Mom's contact",
        steps: [{ id: "step-1", title: "Open Contacts", durationMinutes: 1, state: "current" }],
      },
      context: [{ id: "signal-1", source: "notification", title: "Missed call", content: "Mom" }],
      mode: "deep",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a request without a usable task title", () => {
    const result = taskCoachRequestSchema.safeParse({ task: { id: "task-1", title: "   " } });
    expect(result.success).toBe(false);
  });

  it("accepts and normalizes a reviewable Opus plan", () => {
    const result = taskCoachPlanSchema.parse({
      summary: "Make the return call small and specific.",
      firstStep: "Open Mom's contact.",
      chunks: [{ title: "Open Contacts", minutes: "1" }, { title: "Call Mom", minutes: 5 }],
      lowEnergyVersion: "Send a short text asking when to call.",
      frictionPlan: [{ friction: "You do not know what to say", response: "Write one sentence first." }],
      habitPlan: null,
      behavioralActivation: null,
    });

    expect(result.chunks[0].minutes).toBe(1);
  });

  it("rejects an empty plan that could erase the current task steps", () => {
    const result = taskCoachPlanSchema.safeParse({
      summary: "No plan",
      firstStep: "Wait",
      chunks: [],
      lowEnergyVersion: "Wait",
      frictionPlan: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects incomplete or extra model output instead of guessing", () => {
    const result = taskCoachPlanSchema.safeParse({
      summary: "Start small.",
      firstStep: "Open the contact.",
      chunks: [{ title: "Open Contacts", minutes: 1 }],
      lowEnergyVersion: "Send a short text.",
      frictionPlan: [],
      unsupportedAdvice: "This key is not part of the contract.",
    });

    expect(result.success).toBe(false);
  });
});
