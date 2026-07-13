import { describe, expect, it } from "vitest";
import type { SentinelEvent } from "./types";
import { buildLocalRelevanceAudit, buildSmartSituations, situationFingerprint, smartTasksFromSituations } from "./decisionEngine";

const NOW = new Date(2026, 4, 31, 13, 30).getTime();

function signal(overrides: Partial<SentinelEvent>): SentinelEvent {
  return {
    id: overrides.id || "fixture",
    timestamp: overrides.timestamp || "10:00 AM",
    source: overrides.source || "sms",
    title: overrides.title || "SMS from Alex",
    content: overrides.content || "Can you send the form by 3pm?",
    capturedAtEpochMillis: overrides.capturedAtEpochMillis || NOW,
    packageName: overrides.packageName,
  };
}

describe("decision engine", () => {
  it("clusters related phone signals into one situation with evidence", () => {
    const logs = [
      signal({ id: "sms-1", title: "SMS from Alex", content: "Can you send the form by 3pm?" }),
      signal({ id: "sms-2", title: "SMS from Alex", content: "Please send that form today." }),
      signal({ id: "screen-1", source: "screen_text", title: "Foreground screen text: Alex", content: "Alex: send the form by 3pm" }),
      signal({ id: "usage", source: "app_usage", title: "App usage: YouTube", content: "scrolling reels" }),
    ];

    const situations = buildSmartSituations(logs, {}, new Date(2026, 4, 31, 13, 30).getTime());

    expect(situations).toHaveLength(1);
    expect(situations[0].title).toBe("Send the form");
    expect(situations[0].signals).toHaveLength(3);
    expect(situations[0].confidence).toBe("high");
    expect(situations[0].why.join(" ")).toContain("related signals");
    expect(situations[0].evidence[0]).toContain("sms:");
    expect(situations[0].task.associatedAnchorId).toBe(situations[0].id);
  });

  it("uses feedback to suppress or lift future situations", () => {
    const log = signal({ id: "sms", title: "SMS from Alex", content: "Could you send the form by 3pm?" });
    const fingerprint = situationFingerprint(log);

    expect(buildSmartSituations([log], { [fingerprint]: { kind: "not_task", updatedAt: 1 } })).toHaveLength(0);

    const plain = buildSmartSituations([log], {}, new Date(2026, 4, 31, 12, 0).getTime())[0];
    const useful = buildSmartSituations([log], { [fingerprint]: { kind: "useful", updatedAt: 1 } }, new Date(2026, 4, 31, 12, 0).getTime())[0];
    expect(useful.priorityScore).toBeGreaterThan(plain.priorityScore);
  });

  it("ranks urgent calendar and missed call situations above weaker tasks", () => {
    const now = new Date(2026, 4, 31, 13, 45).getTime();
    const logs = [
      signal({ id: "weak", title: "SMS from Sam", content: "Please check in sometime this week." }),
      signal({ id: "missed", source: "notification", title: "Missed call: Mom", content: "Duration: 0 seconds" }),
      signal({ id: "calendar", source: "calendar", title: "Calendar: Davidson appointment", content: "Bring paperwork at 2pm", capturedAtEpochMillis: now }),
    ];

    const situations = buildSmartSituations(logs, {}, now);
    const tasks = smartTasksFromSituations(situations);

    expect(situations[0].title).toBe("Get ready for Davidson appointment");
    expect(situations[0].urgency).toBe("now");
    expect(tasks.map(task => task.title)).toContain("Call Mom back");
    expect(tasks.every(task => task.associatedAnchorId)).toBe(true);
  });

  it("builds a manual relevance audit without flagging actionable screen text", () => {
    const logs = [
      signal({ id: "screen", source: "screen_text", title: "Foreground screen text: Messages", content: "Jordan: please bring paperwork at 2pm" }),
      signal({ id: "call", source: "notification", title: "Incoming call: Dad", content: "Duration: 120 seconds" }),
      signal({ id: "usage", source: "app_usage", title: "App usage: Phone", content: "20 minutes foreground" }),
    ];

    const audit = buildLocalRelevanceAudit(logs, [], "local-heuristic", NOW);

    expect(audit.items.map(item => item.targetId)).toContain("call");
    expect(audit.items.map(item => item.targetId)).toContain("usage");
    expect(audit.items.map(item => item.targetId)).not.toContain("screen");
  });
});
