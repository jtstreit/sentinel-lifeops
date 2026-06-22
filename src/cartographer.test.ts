import { describe, expect, it } from "vitest";
import { generateReverseTimeline, minutesToTimeString } from "./cartographer";
import type { ExecutiveStep } from "./types";

describe("generateReverseTimeline", () => {
  it("keeps cross-midnight prep steps in real chronological order", () => {
    const steps: ExecutiveStep[] = [
      { id: "shower", title: "Shower and dress", durationMinutes: 30, state: "current" },
      { id: "bag", title: "Pack bag", durationMinutes: 10, state: "pending" },
    ];

    const timeline = generateReverseTimeline("00:20", steps, 20, 10);

    expect(timeline.reverseSteps.map(step => step.absoluteTime)).toEqual([
      "23:10",
      "23:40",
      "23:50",
      "00:10",
      "00:20",
    ]);
    expect(minutesToTimeString(timeline.hardLeaveMinutes)).toBe("23:50");
    expect(minutesToTimeString(timeline.prepStartMinutes)).toBe("23:10");
    expect(timeline.reverseSteps.map(step => step.label)).toEqual([
      "Shower and dress",
      "Pack bag",
      "HARD LEAVE TIME (Start Traveling)",
      "Mental Cool-down & Transition Buffer",
      "Anchor Event (Target Start Time)",
    ]);
  });
});
