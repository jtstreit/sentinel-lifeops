import { describe, expect, it } from "vitest";
import type { ExecutiveTask, SentinelEvent } from "./types";
import {
  coerceTimeString,
  extractTasksHeuristic,
  inferTargetTimeFromSignal,
  isExpiredSignal,
  isTaskCandidateSignal,
  mergeStoredTasks,
  migrateStoredState,
  normalizeStoredTask,
  normalizeTask,
  sanitizeExtractedTasks,
  scoreSignal,
  scoreTelemetryLog,
  STORAGE_SCHEMA_VERSION,
} from "./lifeopsRules";

const NOW = new Date(2026, 4, 31, 13, 0).getTime();

function signal(overrides: Partial<SentinelEvent>): SentinelEvent {
  return {
    id: overrides.id || "fixture",
    timestamp: overrides.timestamp || "10:00 AM",
    source: overrides.source || "notification",
    title: overrides.title || "Fixture",
    content: overrides.content || "",
    capturedAtEpochMillis: overrides.capturedAtEpochMillis || NOW,
    packageName: overrides.packageName,
  };
}

describe("lifeops scoring rules", () => {
  it("keeps app usage and ordinary calls from becoming fake tasks", () => {
    const distraction = signal({
      id: "youtube",
      source: "app_usage",
      title: "App usage: YouTube",
      content: "Estimated focus block: 20 minutes foreground",
      packageName: "com.google.android.youtube",
    });
    const launcher = signal({
      id: "launcher",
      source: "app_usage",
      title: "App usage: Launcher",
      content: "Home screen foreground",
      packageName: "com.android.launcher",
    });
    const ordinaryCall = signal({
      id: "call",
      source: "notification",
      title: "Incoming call: Dad",
      content: "Duration: 120 seconds",
    });

    expect(scoreSignal(distraction, NOW)).toBe(2);
    expect(isTaskCandidateSignal(distraction, NOW)).toBe(false);
    expect(scoreSignal(launcher, NOW)).toBe(0);
    expect(isTaskCandidateSignal(launcher, NOW)).toBe(false);
    expect(scoreSignal(ordinaryCall, NOW)).toBe(1);
    expect(isTaskCandidateSignal(ordinaryCall, NOW)).toBe(false);
  });

  it("allows missed calls and concrete messages to become tasks", () => {
    const missedCall = signal({
      id: "missed",
      source: "notification",
      title: "Missed call: Dad",
      content: "Duration: 0 seconds",
    });
    const message = signal({
      id: "sms",
      source: "sms",
      title: "SMS from Jordan",
      content: "Can you pick up meds at 4pm?",
    });
    const placeholder = signal({
      id: "placeholder",
      source: "notification",
      title: "Follow up: Cloud_ file -- Reminder",
      content: "Open the source signal only",
    });

    expect(scoreSignal(missedCall, NOW)).toBe(4);
    expect(isTaskCandidateSignal(missedCall, NOW)).toBe(true);
    expect(scoreSignal(message, NOW)).toBeGreaterThanOrEqual(5);
    expect(isTaskCandidateSignal(message, NOW)).toBe(true);
    expect(scoreSignal(placeholder, NOW)).toBe(0);
    expect(isTaskCandidateSignal(placeholder, NOW)).toBe(false);

    const tasks = extractTasksHeuristic([missedCall, message, placeholder], NOW);
    expect(tasks.map(task => task.title)).toContain("Return missed call from Dad");
    expect(tasks.find(task => task.title.includes("meds"))?.targetTime).toBe("16:00");
  });

  it("lets foreground screen text become a task when the visible app text is actionable", () => {
    const foregroundText = signal({
      id: "screen",
      source: "screen_text",
      title: "Foreground screen text: com.google.android.apps.messaging",
      content: "Jordan: Could you bring the paperwork to the appointment at 2pm?",
      packageName: "com.google.android.apps.messaging",
    });

    expect(scoreSignal(foregroundText, NOW)).toBeGreaterThanOrEqual(5);
    expect(isTaskCandidateSignal(foregroundText, NOW)).toBe(true);

    const task = extractTasksHeuristic([foregroundText], NOW)[0];
    expect(task.title).toContain("Prepare item");
    expect(task.targetTime).toBe("14:00");
  });

  it("blocks Sentinel and system foreground text from self-generating tasks", () => {
    const selfCapture = signal({
      id: "self",
      source: "screen_text",
      title: "Foreground screen text: com.jackson.sentinellifeops",
      content: "Refresh phone data | Create task cards | Have Claude check",
      packageName: "com.jackson.sentinellifeops",
    });

    expect(scoreSignal(selfCapture, NOW)).toBe(0);
    expect(isTaskCandidateSignal(selfCapture, NOW)).toBe(false);
    expect(extractTasksHeuristic([selfCapture], NOW)).toHaveLength(0);
  });

  it("does not suggest tasks when the explicit time or date has already passed", () => {
    const staleToday = signal({
      id: "stale-today",
      source: "sms",
      title: "SMS from Jordan",
      content: "Can you bring paperwork today at 9am?",
    });
    const staleDate = signal({
      id: "stale-date",
      source: "screen_text",
      title: "Foreground screen text: Messages",
      content: "Alex: please send the form May 30 at 4pm",
    });
    const future = signal({
      id: "future",
      source: "sms",
      title: "SMS from Jordan",
      content: "Can you bring paperwork tomorrow at 9am?",
    });

    expect(isExpiredSignal(staleToday, NOW)).toBe(true);
    expect(scoreSignal(staleToday, NOW)).toBe(0);
    expect(isTaskCandidateSignal(staleToday, NOW)).toBe(false);
    expect(isExpiredSignal(staleDate, NOW)).toBe(true);
    expect(isTaskCandidateSignal(staleDate, NOW)).toBe(false);
    expect(isExpiredSignal(future, NOW)).toBe(false);
    expect(isTaskCandidateSignal(future, NOW)).toBe(true);
    expect(extractTasksHeuristic([staleToday, staleDate, future], NOW)).toHaveLength(1);
  });
});

describe("time inference", () => {
  it("coerces only valid HH:MM strings", () => {
    expect(coerceTimeString("4:05")).toBe("04:05");
    expect(coerceTimeString("23:59")).toBe("23:59");
    expect(coerceTimeString("24:00")).toBeNull();
    expect(coerceTimeString("12:60")).toBeNull();
    expect(coerceTimeString("noon")).toBeNull();
  });

  it("infers explicit, contextual, and calendar times", () => {
    const calendarStart = new Date(2026, 4, 31, 14, 15).getTime();
    expect(inferTargetTimeFromSignal(signal({ content: "Please arrive by 4:30pm." }))).toBe("16:30");
    expect(inferTargetTimeFromSignal(signal({ title: "Meeting at 4", content: "Bring notes." }))).toBe("16:00");
    expect(inferTargetTimeFromSignal(signal({
      source: "calendar",
      title: "Calendar: Therapy",
      content: "Office visit",
      capturedAtEpochMillis: calendarStart,
    }))).toBe("14:15");
  });
});

describe("stored state migration", () => {
  it("strips placeholder tasks and clears stale generated feeds", () => {
    const realTask: ExecutiveTask = {
      id: "real",
      title: "Pay rent",
      estimatedDurationMinutes: 10,
      isCompleted: false,
      targetTime: "16:00",
      avoidanceTarget: "Opening unrelated apps",
      nextPhysicalAction: "Open the rent portal.",
      steps: [{ id: "step", title: "Open the rent portal", durationMinutes: 5, state: "current" }],
    };
    const placeholderTask = {
      id: "fake",
      title: "Follow up: Cloud_ file -- Reminder",
      estimatedDurationMinutes: 15,
      isCompleted: false,
      avoidanceTarget: "Avoidance rabbit hole",
      nextPhysicalAction: "",
      steps: [{ id: "fake-step", title: "Open the source signal only", durationMinutes: 3, state: "current" }],
    };
    const data = new Map<string, string>([
      ["sentinel-lifeops:schemaVersion", "old"],
      ["sentinel-lifeops:activeTasks", JSON.stringify([placeholderTask, realTask])],
      ["sentinel-lifeops:extractedTasks", JSON.stringify([placeholderTask])],
      ["sentinel-lifeops:sentinelFeed", JSON.stringify([{ title: "sample" }])],
    ]);
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    };

    migrateStoredState(storage);

    expect(JSON.parse(data.get("sentinel-lifeops:activeTasks") || "[]")).toEqual([realTask]);
    expect(data.has("sentinel-lifeops:extractedTasks")).toBe(false);
    expect(data.has("sentinel-lifeops:sentinelFeed")).toBe(false);
    expect(data.get("sentinel-lifeops:schemaVersion")).toBe(STORAGE_SCHEMA_VERSION);
  });
});

describe("server-facing heuristic aliases", () => {
  const fixtures: Array<{ name: string; log: SentinelEvent; score: number; candidate: boolean }> = [
    {
      name: "android launcher usage",
      log: signal({ source: "app_usage", title: "App usage: Launcher", content: "foreground", packageName: "com.android.launcher" }),
      score: 0,
      candidate: false,
    },
    {
      name: "scroll drift",
      log: signal({ source: "app_usage", title: "App usage: Instagram", content: "scrolling reels", packageName: "com.instagram.android" }),
      score: 2,
      candidate: false,
    },
    {
      name: "missed call",
      log: signal({ source: "notification", title: "Missed call: Mom", content: "Duration: 0 seconds" }),
      score: 4,
      candidate: true,
    },
    {
      name: "action sms",
      log: signal({ source: "sms", title: "SMS from Alex", content: "Could you send the form by 3pm?" }),
      score: 6,
      candidate: true,
    },
    {
      name: "foreground screen task",
      log: signal({ source: "screen_text", title: "Foreground screen text: Messages", content: "Please bring paperwork at 2pm." }),
      score: 5,
      candidate: true,
    },
    {
      name: "weather noise",
      log: signal({ source: "notification", title: "Weather", content: "Rain forecast and cooler than yesterday." }),
      score: 0,
      candidate: false,
    },
  ];

  it("keeps client and server scoring fixtures in parity", () => {
    for (const fixture of fixtures) {
      expect(scoreSignal(fixture.log, NOW), fixture.name).toBe(fixture.score);
      expect(scoreTelemetryLog(fixture.log, NOW), fixture.name).toBe(fixture.score);
      expect(isTaskCandidateSignal(fixture.log, NOW), fixture.name).toBe(fixture.candidate);
    }
  });

  it("extracts only real tasks through the server fallback path", () => {
    const tasks = extractTasksHeuristic(fixtures.map(fixture => fixture.log), NOW);
    expect(tasks).toHaveLength(3);
    expect(tasks.map(task => task.title)).toEqual([
      "Send or submit: Could you send the form by 3pm?",
      "Prepare item: Please bring paperwork at 2pm.",
      "Return missed call from Mom",
    ]);
    expect(tasks[0].targetTime).toBe("15:00");
    expect(tasks[1].targetTime).toBe("14:00");
  });
});

describe("AI task sanitation", () => {
  const aiTask = (overrides: Record<string, unknown> = {}) => ({
    title: "Send the rent confirmation to Sam",
    why: "Sam texted asking for the rent to be sent by Friday 5pm.",
    urgency: "soon",
    estimatedDurationMinutes: 15,
    avoidanceTarget: "Opening other apps first",
    nextPhysicalAction: "Open the banking app",
    steps: [{ title: "Open the app", durationMinutes: 3 }, { title: "Send and confirm", durationMinutes: 8 }],
    sourceLogIds: ["log1"],
    situationId: "sit1",
    ...overrides,
  });

  it("carries why/urgency/traceability through normalizeTask and clips long why text", () => {
    const task = normalizeTask(aiTask({ why: `${"x".repeat(400)}` }));
    expect(task).not.toBeNull();
    expect(task!.why).toHaveLength(280);
    expect(task!.urgency).toBe("soon");
    expect(task!.sourceLogIds).toEqual(["log1"]);
    expect(task!.situationId).toBe("sit1");
  });

  it("drops invalid urgency values instead of storing them", () => {
    const task = normalizeTask(aiTask({ urgency: "immediately" }));
    expect(task!.urgency).toBeUndefined();
  });

  it("strips forged sourceLogIds and situationIds the request never contained", () => {
    const tasks = sanitizeExtractedTasks(
      [aiTask({ sourceLogIds: ["log1", "forged-id"], situationId: "forged-sit" })],
      new Set(["log1"]),
      new Set(["sit1"])
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].sourceLogIds).toEqual(["log1"]);
    expect(tasks[0].situationId).toBeUndefined();
  });

  it("tolerates garbage input and caps output at 6 tasks", () => {
    expect(sanitizeExtractedTasks("not an array", new Set(), new Set())).toEqual([]);
    expect(sanitizeExtractedTasks([null, 42, { title: "" }], new Set(), new Set())).toEqual([]);
    const many = sanitizeExtractedTasks(
      Array.from({ length: 10 }, (_, i) => aiTask({ title: `Task number ${i}` })),
      new Set(["log1"]),
      new Set(["sit1"])
    );
    expect(many).toHaveLength(6);
  });
});

describe("stored task normalization and merge", () => {
  it("preserves completion state and step progress (unlike normalizeTask)", () => {
    const stored = normalizeStoredTask({
      id: "t1",
      title: "Return missed call from Mom",
      status: "done",
      isCompleted: true,
      updatedAtEpochMillis: 111,
      createdAtEpochMillis: 100,
      completedAtEpochMillis: 110,
      steps: [
        { id: "t1-1", title: "Open Phone", durationMinutes: 2, state: "done" },
        { id: "t1-2", title: "Call Mom", durationMinutes: 5, state: "done" },
      ],
    });
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe("done");
    expect(stored!.isCompleted).toBe(true);
    expect(stored!.completedAtEpochMillis).toBe(110);
    expect(stored!.steps.map(step => step.state)).toEqual(["done", "done"]);
  });

  it("defaults status from isCompleted and rejects tasks without id or title", () => {
    expect(normalizeStoredTask({ id: "t2", title: "Open task", isCompleted: false }, 500)!.status).toBe("open");
    expect(normalizeStoredTask({ id: "t3", title: "Done task", isCompleted: true }, 500)!.status).toBe("done");
    expect(normalizeStoredTask({ title: "No id" })).toBeNull();
    expect(normalizeStoredTask({ id: "t4" })).toBeNull();
  });

  it("merges newer-wins by updatedAtEpochMillis in both directions", () => {
    const older = normalizeStoredTask({ id: "t1", title: "Task", status: "open", updatedAtEpochMillis: 100 })!;
    const newer = normalizeStoredTask({ id: "t1", title: "Task", status: "done", isCompleted: true, updatedAtEpochMillis: 200 })!;
    expect(mergeStoredTasks([older], [newer])[0].status).toBe("done");
    expect(mergeStoredTasks([newer], [older])[0].status).toBe("done");
    const both = mergeStoredTasks([older], [normalizeStoredTask({ id: "t2", title: "Other", updatedAtEpochMillis: 300 })!]);
    expect(both.map(task => task.id)).toEqual(["t2", "t1"]);
  });
});
