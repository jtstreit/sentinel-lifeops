import type { ExecutiveTask, SentinelEvent, SentinelSource } from "./types";
import {
  buildTaskFromSignal,
  cleanSignalFragment,
  hasActionLanguage,
  hasTimeLanguage,
  inferTargetTimeFromSignal,
  isCallLogSignal,
  isDistractionSignal,
  isMissedCallSignal,
  isNoiseSignalText,
  isPlaceholderSignalText,
  isSystemAppUsageSignal,
  isSystemScreenTextSignal,
  isTaskCandidateSignal,
  normalizeSignal,
  scoreSignal,
} from "./lifeopsRules";

export type DecisionFeedbackKind = "useful" | "not_task" | "too_vague" | "later" | "done";

export type DecisionFeedback = {
  kind: DecisionFeedbackKind;
  updatedAt: number;
};

export type DecisionFeedbackMap = Record<string, DecisionFeedback>;

export type SmartSituation = {
  id: string;
  fingerprint: string;
  title: string;
  task: ExecutiveTask;
  primarySignal: SentinelEvent;
  signals: SentinelEvent[];
  sourceSummary: string;
  priorityScore: number;
  confidence: "low" | "medium" | "high";
  urgency: "now" | "soon" | "later";
  why: string[];
  evidence: string[];
  recommendedAction: string;
  needsModelReview: boolean;
  feedback?: DecisionFeedback;
};

export type RelevanceAuditTargetKind = "signal" | "situation" | "task";

export type RelevanceAuditItem = {
  id: string;
  targetKind: RelevanceAuditTargetKind;
  targetId: string;
  title: string;
  reason: string;
  confidence: "low" | "medium" | "high";
  fingerprint?: string;
  associatedTaskId?: string;
  associatedSignalIds?: string[];
};

export type RelevanceAudit = {
  id: string;
  createdAt: number;
  engine: "claude-agent-sdk" | "claude-sdk" | "claude-code-cli" | "deepseek" | "local-heuristic";
  summary: string;
  checkedSignalCount: number;
  checkedSituationCount: number;
  items: RelevanceAuditItem[];
};

const ACTION_SOURCE_WEIGHTS: Record<SentinelSource, number> = {
  sms: 4,
  notification: 3,
  calendar: 5,
  location: 0,
  app_usage: 0,
  screen_text: 3,
  user_note: 3,
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contactFromSignal(log: SentinelEvent): string {
  if (log.source === "screen_text") {
    const screenSender = log.content.match(/^([A-Z][A-Za-z0-9.'-]{1,24}(?:\s+[A-Z][A-Za-z0-9.'-]{1,24}){0,2})\s*:/);
    if (screenSender?.[1]) return normalizeText(screenSender[1]).slice(0, 40);
  }

  const title = cleanSignalFragment(log.title, 80);
  const contactMatch = title.match(/^(?:sms from|missed call:|incoming call:|outgoing call:|notification from|active notification from)\s+(.+)$/i);
  if (contactMatch?.[1]) return normalizeText(contactMatch[1]).slice(0, 40);

  const namedSender = title.match(/^([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\s*:/);
  if (namedSender?.[1]) return normalizeText(namedSender[1]).slice(0, 40);

  if (log.source === "calendar") return `calendar:${normalizeText(title).slice(0, 54)}`;
  return normalizeText(title).split(" ").slice(0, 4).join(" ") || "unknown";
}

function actionPhrase(log: SentinelEvent): string {
  const text = normalizeText(`${log.title} ${log.content}`);
  const action = text.match(/\b(reply|respond|send|submit|pay|pickup|pick up|bring|call|schedule|reschedule|confirm|leave|arrive|meet|meeting|appointment|deadline|due|rent|form|meds|medicine)\b/);
  return action?.[1]?.replace(/\s+/g, "-") || "action";
}

export function situationFingerprint(log: SentinelEvent): string {
  const entity = contactFromSignal(log);
  const action = actionPhrase(log);
  if (log.source === "calendar") return `calendar:${entity}`;
  if (isMissedCallSignal(log)) return `return-call:${entity}`;
  return `${entity}:${action}`;
}

function sourceSummary(logs: SentinelEvent[]): string {
  const counts = logs.reduce<Record<string, number>>((acc, log) => {
    acc[log.source] = (acc[log.source] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => `${count} ${source === "app_usage" ? "app" : source === "screen_text" ? "screen text" : source}`)
    .join(", ");
}

function feedbackAdjustment(feedback?: DecisionFeedback): number {
  if (!feedback) return 0;
  if (feedback.kind === "useful") return 5;
  if (feedback.kind === "done") return 7;
  if (feedback.kind === "later") return -1;
  if (feedback.kind === "too_vague") return -4;
  return -99;
}

function urgencyFor(log: SentinelEvent, now: number): "now" | "soon" | "later" {
  const target = inferTargetTimeFromSignal(log);
  if (!target) return isMissedCallSignal(log) ? "soon" : "later";
  const [hours, minutes] = target.split(":").map(Number);
  const targetDate = new Date(now);
  targetDate.setHours(hours, minutes, 0, 0);
  const deltaMinutes = (targetDate.getTime() - now) / 60000;
  if (deltaMinutes >= -15 && deltaMinutes <= 90) return "now";
  if (deltaMinutes > 90 && deltaMinutes <= 360) return "soon";
  return "later";
}

function buildWhy(logs: SentinelEvent[]): string[] {
  const primary = logs[0];
  const text = `${logs.map(log => `${log.title} ${log.content}`).join(" ")}`;
  const why: string[] = [];
  if (logs.length > 1) why.push(`${logs.length} related signals point at the same situation.`);
  if (isMissedCallSignal(primary)) why.push("Missed call means a return-call decision is probably needed.");
  if (logs.some(log => log.source === "calendar")) why.push("Calendar context gives this a real time anchor.");
  if (hasActionLanguage(text)) why.push("The wording contains a concrete request or commitment.");
  if (hasTimeLanguage(text)) why.push("A time cue is present, so planning can be attached to it.");
  if (why.length === 0) why.push("Local rules found enough task signal, but the wording is still thin.");
  return why.slice(0, 4);
}

function buildEvidence(logs: SentinelEvent[]): string[] {
  return logs.slice(0, 4).map(log => {
    const title = cleanSignalFragment(log.title, 54);
    const content = cleanSignalFragment(log.content || log.title, 86);
    return `${log.source}: ${title}${content && content !== title ? ` - ${content}` : ""}`;
  });
}

function priorityFor(logs: SentinelEvent[], feedback: DecisionFeedback | undefined, now: number): number {
  const primary = logs[0];
  const maxSignalScore = Math.max(...logs.map(log => scoreSignal(log, now)));
  let score = maxSignalScore * 10;
  score += Math.min(3, logs.length - 1) * 5;
  score += ACTION_SOURCE_WEIGHTS[primary.source] || 0;
  if (isMissedCallSignal(primary)) score += 12;
  if (logs.some(log => log.source === "calendar")) score += 10;
  if (logs.some(log => hasTimeLanguage(`${log.title} ${log.content}`))) score += 8;
  if (urgencyFor(primary, now) === "now") score += 16;
  if (urgencyFor(primary, now) === "soon") score += 8;
  score += feedbackAdjustment(feedback);
  return Math.max(0, score);
}

function confidenceFor(logs: SentinelEvent[], priorityScore: number): "low" | "medium" | "high" {
  if (priorityScore >= 78 || logs.length >= 2 || logs.some(log => inferTargetTimeFromSignal(log))) return "high";
  if (priorityScore >= 48) return "medium";
  return "low";
}

function compileTask(primary: SentinelEvent, signals: SentinelEvent[], situationId: string, now: number): ExecutiveTask | null {
  const task = buildTaskFromSignal(primary, 0, now);
  if (!task) return null;
  const evidenceCount = signals.length;
  const firstStepTitle = task.steps[0]?.title || task.nextPhysicalAction;
  return {
    ...task,
    id: `smart-task-${situationId}`,
    associatedAnchorId: situationId,
    avoidanceTarget: evidenceCount > 1
      ? "Rereading related messages before doing the task"
      : task.avoidanceTarget,
    nextPhysicalAction: evidenceCount > 1
      ? `${firstStepTitle} Check the related signals only if you need context.`
      : task.nextPhysicalAction,
  };
}

export function buildSmartSituations(
  rawLogs: Array<SentinelEvent | any>,
  feedbackMap: DecisionFeedbackMap = {},
  now = Date.now()
): SmartSituation[] {
  const grouped = new Map<string, SentinelEvent[]>();
  for (const [index, raw] of rawLogs.entries()) {
    const log = normalizeSignal(raw, index, now);
    if (!isTaskCandidateSignal(log, now)) continue;
    const key = situationFingerprint(log);
    grouped.set(key, [...(grouped.get(key) || []), log]);
  }

  const situations: SmartSituation[] = [];
  for (const [fingerprint, logs] of grouped.entries()) {
    const sorted = logs.sort((a, b) => {
      const scoreDiff = scoreSignal(b, now) - scoreSignal(a, now);
      if (scoreDiff !== 0) return scoreDiff;
      return (b.capturedAtEpochMillis || 0) - (a.capturedAtEpochMillis || 0);
    });
    const primary = sorted[0];
    const situationId = `situation-${fingerprint.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 64)}`;
    const feedback = feedbackMap[fingerprint] || feedbackMap[situationId];
    if (feedback?.kind === "not_task") continue;

    const task = compileTask(primary, sorted, situationId, now);
    if (!task) continue;
    const priorityScore = priorityFor(sorted, feedback, now);
    const confidence = confidenceFor(sorted, priorityScore);
    const urgency = urgencyFor(primary, now);
    const why = buildWhy(sorted);
    const needsModelReview = confidence !== "high" && sorted.length === 1 && !inferTargetTimeFromSignal(primary);

    situations.push({
      id: situationId,
      fingerprint,
      title: task.title,
      task,
      primarySignal: primary,
      signals: sorted,
      sourceSummary: sourceSummary(sorted),
      priorityScore,
      confidence,
      urgency,
      why,
      evidence: buildEvidence(sorted),
      recommendedAction: task.nextPhysicalAction,
      needsModelReview,
      feedback,
    });
  }

  return situations.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    return (b.primarySignal.capturedAtEpochMillis || 0) - (a.primarySignal.capturedAtEpochMillis || 0);
  }).slice(0, 8);
}

export function smartTasksFromSituations(situations: SmartSituation[]): ExecutiveTask[] {
  return situations.map(situation => situation.task);
}

function pushUniqueAuditItem(items: RelevanceAuditItem[], item: RelevanceAuditItem) {
  if (items.some(existing => existing.targetKind === item.targetKind && existing.targetId === item.targetId)) return;
  items.push(item);
}

function signalAuditTitle(log: SentinelEvent): string {
  const label = cleanSignalFragment(log.title, 70);
  return `${label}${log.content ? ` - ${cleanSignalFragment(log.content, 70)}` : ""}`;
}

export function buildLocalRelevanceAudit(
  rawSignals: Array<SentinelEvent | any>,
  situations: SmartSituation[] = [],
  engine: RelevanceAudit["engine"] = "local-heuristic",
  now = Date.now()
): RelevanceAudit {
  const signals = rawSignals.map((signal, index) => normalizeSignal(signal, index, now)).slice(0, 80);
  const items: RelevanceAuditItem[] = [];

  for (const log of signals) {
    const text = `${log.title} ${log.content}`;
    const score = scoreSignal(log, now);
    let reason = "";
    let confidence: RelevanceAuditItem["confidence"] = "medium";

    if (isPlaceholderSignalText(text)) {
      reason = "Looks like leftover demo or placeholder text rather than a real current-life signal.";
      confidence = "high";
    } else if (log.source === "app_usage" && isSystemAppUsageSignal(log)) {
      reason = "System app usage is implementation noise and should not become a task.";
      confidence = "high";
    } else if (isSystemScreenTextSignal(log)) {
      reason = "Sentinel or Android system screen text is implementation noise and can create self-capture loops.";
      confidence = "high";
    } else if (isCallLogSignal(log) && !isMissedCallSignal(log)) {
      reason = "Ordinary incoming or outgoing call duration is context only unless a follow-up is visible.";
      confidence = "high";
    } else if (log.source === "app_usage" && !isDistractionSignal(text)) {
      reason = "App foreground time without drift language is not a task by itself.";
      confidence = "medium";
    } else if (log.source !== "calendar" && isNoiseSignalText(text)) {
      reason = "Weather, battery, charging, or passive status text is unlikely to need action.";
      confidence = "high";
    } else if (!isTaskCandidateSignal(log, now) && score === 0 && log.source !== "location") {
      reason = "No request, time cue, missed call, deadline, or commitment is visible.";
      confidence = "low";
    }

    if (!reason) continue;
    pushUniqueAuditItem(items, {
      id: `audit-signal-${log.id}`,
      targetKind: "signal",
      targetId: log.id,
      title: signalAuditTitle(log),
      reason,
      confidence,
      associatedSignalIds: [log.id],
    });
  }

  for (const situation of situations.slice(0, 12)) {
    if (situation.feedback?.kind === "useful" || situation.feedback?.kind === "done") continue;
    if (!situation.needsModelReview && situation.priorityScore >= 48) continue;
    if (situation.signals.length > 1 || situation.urgency === "now") continue;

    pushUniqueAuditItem(items, {
      id: `audit-situation-${situation.id}`,
      targetKind: "situation",
      targetId: situation.id,
      title: situation.title,
      reason: "This is a low-confidence single-signal suggestion. It may be worth clearing if it does not match your real day.",
      confidence: situation.priorityScore < 38 ? "medium" : "low",
      fingerprint: situation.fingerprint,
      associatedTaskId: situation.task.id,
      associatedSignalIds: situation.signals.map(signal => signal.id),
    });
  }

  const high = items.filter(item => item.confidence === "high").length;
  const summary = items.length === 0
    ? "No obvious irrelevant items found."
    : `${items.length} item${items.length === 1 ? "" : "s"} may be irrelevant; ${high} look like high-confidence cleanup.`;

  return {
    id: `audit-${now}`,
    createdAt: now,
    engine,
    summary,
    checkedSignalCount: signals.length,
    checkedSituationCount: situations.length,
    items: items.slice(0, 10),
  };
}
