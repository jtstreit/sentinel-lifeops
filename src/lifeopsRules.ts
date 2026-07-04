import type { ExecutiveTask, SentinelEvent, StoredTask, StoredTaskStatus, TaskUrgency } from "./types";
import { formatTo12Hour, minutesToTimeString } from "./cartographer";

export const STORAGE_SCHEMA_VERSION = "lifeops-time-ui-v8";
export const TASK_SIGNAL_THRESHOLD = 3;
export const MAX_STORED_ITEMS = 500;
const EXPIRED_SIGNAL_GRACE_MS = 90 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function looksLikePlaceholderTask(task: any): boolean {
  const stepText = Array.isArray(task?.steps)
    ? task.steps.map((step: any) => `${step?.title || ""} ${step?.description || ""}`).join(" ")
    : "";
  const text = `${task?.title || ""} ${task?.avoidanceTarget || ""} ${task?.nextPhysicalAction || ""} ${stepText}`.toLowerCase();
  return (
    text.includes("chrome search") ||
    text.includes("twitter") ||
    text.includes("sample") ||
    text.includes("demo") ||
    text.includes("low energy body launch") ||
    text.includes("avoidance rabbit") ||
    text.includes("minutes foreground") ||
    /cloud[\s_-]*file/.test(text) ||
    /open\s+(the\s+)?source\s+signal\s+only/.test(text) ||
    /^interrupt phone drift/i.test(task?.title || "") ||
    /^follow up:\s*duration:/i.test(task?.title || "")
  );
}

function loadStoredArrayFrom<T>(storage: StorageLike, key: string): T[] {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

export function migrateStoredState(storage?: StorageLike) {
  const target = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!target) return;

  try {
    const current = target.getItem("sentinel-lifeops:schemaVersion");
    if (current === STORAGE_SCHEMA_VERSION) return;

    const activeTasks = loadStoredArrayFrom<ExecutiveTask>(target, "sentinel-lifeops:activeTasks")
      .filter(task => !looksLikePlaceholderTask(task));
    target.setItem("sentinel-lifeops:activeTasks", JSON.stringify(activeTasks.slice(0, MAX_STORED_ITEMS)));
    target.removeItem("sentinel-lifeops:extractedTasks");
    target.removeItem("sentinel-lifeops:sentinelFeed");
    target.setItem("sentinel-lifeops:schemaVersion", STORAGE_SCHEMA_VERSION);
  } catch {
    // Ignore storage migration failures; live collection should keep running.
  }
}

export function cleanSignalFragment(value: string, max = 72): string {
  const cleaned = String(value || "")
    .replace(/^Calendar:\s*/i, "")
    .replace(/^App usage:\s*/i, "")
    .replace(/^Foreground screen text:\s*/i, "")
    .replace(/^Active notification from\s*/i, "")
    .replace(/^Notification from\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const fallback = cleaned || "phone signal";
  return fallback.length > max ? `${fallback.slice(0, max - 1).trim()}...` : fallback;
}

export function isNoiseSignalText(text: string): boolean {
  return /\b(charging|battery|weather|forecast|temperature|humidity|rain|snow|wind|degrees?|cooler than|warmer than|sunny|cloudy|download complete|updated in background)\b|\u00b0|\u00c2\u00b0/i.test(text);
}

export function isClinicalContent(text: string): boolean {
  // PHI/work guard: Credible EHR + Monarch + clinical-program markers. Deliberately
  // narrow (NOT "general sensitive") so ordinary signals still flow. Matching content
  // is dropped before it is ever stored or sent to any LLM.
  return /\bcrediblebh\b|\bcbh3\b|\bcredible\b|\bmonarch\b|\bnctracks\b|\bnc-?topps\b|\bmedicaid\b|\biihs?\b|\bsign and submit\b|\bsvc note\b|\bservice note\b/i.test(String(text || ""));
}

export function isPlaceholderSignalText(text: string): boolean {
  return /cloud[\s_-]*file|open\s+(the\s+)?source\s+signal\s+only|^follow up:\s*.*reminder/i.test(text);
}

export function isDistractionSignal(text: string): boolean {
  return /\b(instagram|reddit|tiktok|youtube|facebook|netflix|reels|shorts|scroll|scrolling)\b/i.test(text);
}

export function isSystemAppUsageSignal(log: Pick<SentinelEvent, "source" | "title" | "content" | "packageName">): boolean {
  const text = `${log.packageName || ""} ${log.title} ${log.content}`.toLowerCase();
  return log.source === "app_usage" && /\b(launcher|systemui|settings|permissioncontroller|webview|sentinel|sentinellifeops|keyboard|inputmethod)\b|^android\.|com\.android\./i.test(text);
}

export function isSystemScreenTextSignal(log: Pick<SentinelEvent, "source" | "title" | "packageName">): boolean {
  if (log.source !== "screen_text") return false;
  const text = `${log.packageName || ""} ${log.title}`.toLowerCase();
  return /\b(launcher|systemui|settings|permissioncontroller|sentinel|sentinellifeops|keyboard|inputmethod)\b|^android\.|com\.android\.|com\.jackson\.sentinellifeops/i.test(text);
}

export function isCallLogSignal(log: Pick<SentinelEvent, "source" | "title" | "content">): boolean {
  return log.source === "notification" && /\b(incoming|outgoing|missed)\s+call:/i.test(log.title) && /\bduration:\s*\d+\s*seconds\b/i.test(log.content);
}

export function isMissedCallSignal(log: Pick<SentinelEvent, "source" | "title" | "content">): boolean {
  return isCallLogSignal(log) && /^missed call:/i.test(log.title);
}

export function hasActionLanguage(text: string): boolean {
  return /\b(due|deadline|appointment|meeting|meet|leave|arrive|pickup|pick up|bring|send|submit|pay|rent|reservation|confirm|shift|need|needs|please|remember|reply|respond|schedule|reschedule|follow up|check in|return call)\b|\b(can you|could you|would you|do you want)\b|\bcall\s+(me|back|them|him|her|us|[a-z][a-z]+)\b/i.test(text);
}

export function hasTimeLanguage(text: string): boolean {
  return /\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\bby\s+\d{1,2}\b|\bat\s+\d{1,2}\b|\btoday\b|\btomorrow\b|\byesterday\b|\btonight\b|\bthis\s+(morning|afternoon|evening|week)\b|\b(mon|tue|wed|thu|fri|sat|sun)(day)?\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/i.test(text);
}

export function formatTimeInput(hour: number, minute = 0): string {
  const normalizedHour = ((hour % 24) + 24) % 24;
  const normalizedMinute = Math.max(0, Math.min(59, minute));
  return `${String(normalizedHour).padStart(2, "0")}:${String(normalizedMinute).padStart(2, "0")}`;
}

export function coerceTimeString(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!/^\d{1,2}:\d{2}$/.test(raw)) return null;
  const [hours, minutes] = raw.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours > 23 || minutes > 59) return null;
  return formatTimeInput(hours, minutes);
}

export function inferTargetTimeFromSignal(log: Pick<SentinelEvent, "source" | "title" | "content" | "capturedAtEpochMillis">): string | null {
  const text = `${log.title} ${log.content}`;
  const explicit = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (explicit) {
    let hour = Number(explicit[1]);
    const minute = Number(explicit[2] || "0");
    const suffix = explicit[3].toLowerCase();
    if (suffix === "pm" && hour < 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
    return formatTimeInput(hour, minute);
  }

  const contextual = text.match(/\b(?:at|by|before|around|arrive|leave|meeting|meet|appointment|reservation|shift)\s+(\d{1,2})(?::(\d{2}))?\b/i);
  if (contextual) {
    let hour = Number(contextual[1]);
    const minute = Number(contextual[2] || "0");
    if (hour >= 1 && hour <= 7) hour += 12;
    return formatTimeInput(hour, minute);
  }

  if (log.source === "calendar" && log.capturedAtEpochMillis) {
    const date = new Date(log.capturedAtEpochMillis);
    if (!Number.isNaN(date.getTime())) return formatTimeInput(date.getHours(), date.getMinutes());
  }

  return null;
}

function startOfLocalDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function dateWithTime(base: Date, time: string | null, useEndOfDay = false): number {
  const target = startOfLocalDay(base);
  if (time) {
    const [hours, minutes] = time.split(":").map(Number);
    target.setHours(hours, minutes, 0, 0);
  } else if (useEndOfDay) {
    target.setHours(23, 59, 59, 999);
  }
  return target.getTime();
}

function inferExplicitDate(text: string, base: Date): Date | null {
  const lower = text.toLowerCase();
  const relative = startOfLocalDay(base);
  if (/\byesterday\b/.test(lower)) {
    relative.setDate(relative.getDate() - 1);
    return relative;
  }
  if (/\btoday\b|\btonight\b/.test(lower)) return relative;
  if (/\btomorrow\b/.test(lower)) {
    relative.setDate(relative.getDate() + 1);
    return relative;
  }

  const numeric = lower.match(/\b(1[0-2]|0?[1-9])[/-]([0-3]?\d)(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    const year = numeric[3]
      ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3])
      : base.getFullYear();
    return new Date(year, Number(numeric[1]) - 1, Number(numeric[2]));
  }

  const monthMap: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
    september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
  };
  const named = lower.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/);
  if (named) {
    const month = monthMap[named[1].replace(".", "")];
    const year = named[3] ? Number(named[3]) : base.getFullYear();
    return new Date(year, month, Number(named[2]));
  }

  const weekdayMap: Record<string, number> = {
    sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
  };
  const weekday = lower.match(/\b(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/);
  if (weekday) {
    const day = weekdayMap[weekday[1]];
    const target = startOfLocalDay(base);
    const delta = (day - target.getDay() + 7) % 7;
    target.setDate(target.getDate() + delta);
    return target;
  }

  return null;
}

export function inferTargetDateTimeFromSignal(
  log: Pick<SentinelEvent, "source" | "title" | "content" | "capturedAtEpochMillis">,
  now = Date.now()
): number | null {
  if (log.source === "calendar" && log.capturedAtEpochMillis) return log.capturedAtEpochMillis;

  const base = new Date(log.capturedAtEpochMillis || now);
  if (Number.isNaN(base.getTime())) return null;
  const text = `${log.title} ${log.content}`;
  const targetTime = inferTargetTimeFromSignal(log);
  const targetDate = inferExplicitDate(text, base);

  if (targetDate) return dateWithTime(targetDate, targetTime, !targetTime);
  if (targetTime) return dateWithTime(base, targetTime);
  return null;
}

export function isExpiredSignal(
  log: Pick<SentinelEvent, "source" | "title" | "content" | "capturedAtEpochMillis">,
  now = Date.now()
): boolean {
  if (isMissedCallSignal(log)) return false;
  const targetAt = inferTargetDateTimeFromSignal(log, now);
  return typeof targetAt === "number" && now > targetAt + EXPIRED_SIGNAL_GRACE_MS;
}

export function scoreSignal(log: Pick<SentinelEvent, "source" | "title" | "content" | "packageName" | "capturedAtEpochMillis">, now = Date.now()): number {
  const text = `${log.title} ${log.content}`.toLowerCase();
  if (isPlaceholderSignalText(text)) return 0;
  if (isClinicalContent(text)) return 0;
  if (log.source !== "calendar" && isNoiseSignalText(text)) return 0;
  if (log.source === "location") return 0;
  if (isExpiredSignal(log, now)) return 0;
  if (isMissedCallSignal(log)) return 4;
  if (isCallLogSignal(log)) return 1;
  if (isSystemAppUsageSignal(log)) return 0;
  if (isSystemScreenTextSignal(log)) return 0;
  if (log.source === "app_usage") return isDistractionSignal(text) ? 2 : 0;

  let score = 0;
  const action = hasActionLanguage(text);
  const timeCue = hasTimeLanguage(text);
  if (log.source === "calendar") score += 4;
  if (action) score += 3;
  if (timeCue && (action || log.source === "calendar")) score += 2;
  if ((log.source === "sms" || log.source === "notification") && action) score += 1;
  if (/\b(ad|sale|promo|newsletter|download|updated|playing|screen time summary)\b/i.test(text)) score -= 2;
  return Math.max(0, score);
}

export const scoreTelemetryLog = scoreSignal;

export function signalReason(log: SentinelEvent, score = scoreSignal(log), now = Date.now()): string {
  if (isExpiredSignal(log, now)) return "Expired time/date. Kept as history, but it will not create a task suggestion.";
  if (isSystemScreenTextSignal(log)) return "System or Sentinel screen text. Kept out of task suggestions to avoid self-capture loops.";
  if (log.source === "app_usage" && isDistractionSignal(`${log.title} ${log.content}`)) {
    return "Drift context only. It can warn you while a task is active, but it will not create a fake task.";
  }
  if (isMissedCallSignal(log)) return "Missed call. This can become a return-call task.";
  if (isCallLogSignal(log)) return "Call history only. Incoming/outgoing calls are kept as context unless a real follow-up is visible.";
  if (log.source === "calendar") return "Calendar event. This can become a preparation task.";
  if (score >= 5) return "Actionable signal with a request, time cue, or commitment.";
  if (score >= TASK_SIGNAL_THRESHOLD) return "Actionable signal. It can become a task suggestion.";
  return "Context only. No concrete request, deadline, or commitment detected.";
}

export function normalizeSignal(log: any, index = 0, now = Date.now()): SentinelEvent {
  const source = ["sms", "notification", "calendar", "location", "app_usage", "screen_text", "user_note"].includes(log?.source)
    ? log.source
    : "notification";
  const normalized: SentinelEvent = {
    id: String(log?.id || `signal-${now}-${index}`),
    timestamp: String(log?.timestamp || formatTo12Hour(minutesToTimeString(new Date(now).getHours() * 60 + new Date(now).getMinutes()))),
    source,
    title: String(log?.title || "Phone signal"),
    content: String(log?.content || ""),
    capturedAtEpochMillis: Number(log?.capturedAtEpochMillis || now - index),
    packageName: log?.packageName ? String(log.packageName) : undefined
  };
  normalized.relevanceScore = scoreSignal(normalized, now);
  normalized.relevanceReason = signalReason(normalized, normalized.relevanceScore, now);
  return normalized;
}

export function isTaskCandidateSignal(log: SentinelEvent, now = Date.now()): boolean {
  if (log.source === "app_usage" || log.source === "location") return false;
  if (isCallLogSignal(log) && !isMissedCallSignal(log)) return false;
  if (isExpiredSignal(log, now)) return false;
  return scoreSignal(log, now) >= TASK_SIGNAL_THRESHOLD;
}

export function taskSignals(logs: SentinelEvent[], now = Date.now()): SentinelEvent[] {
  return logs
    .map(log => ({ log, score: scoreSignal(log, now) }))
    .filter(item => item.score >= TASK_SIGNAL_THRESHOLD && isTaskCandidateSignal(item.log, now))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.log.capturedAtEpochMillis || 0) - (a.log.capturedAtEpochMillis || 0);
    })
    .map(item => item.log)
    .slice(0, 24);
}

export function displaySignals(logs: SentinelEvent[], now = Date.now()): SentinelEvent[] {
  return logs
    .map(log => ({ log, score: scoreSignal(log, now) }))
    .filter(item => (item.score >= 2 || item.log.source === "calendar") && !isExpiredSignal(item.log, now))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.log.capturedAtEpochMillis || 0) - (a.log.capturedAtEpochMillis || 0);
    })
    .map(item => item.log)
    .slice(0, 40);
}

function contactFromTitle(title: string): string {
  return cleanSignalFragment(title
    .replace(/^(sms from|missed call:|incoming call:|outgoing call:|notification from)\s*/i, "")
    .replace(/^active notification from\s*/i, ""), 40);
}

function contactFromScreenText(content: string): string | null {
  const cleaned = String(content || "").trim();
  const match = cleaned.match(/^([A-Z][A-Za-z0-9.'-]{1,24}(?:\s+[A-Z][A-Za-z0-9.'-]{1,24}){0,2})\s*:/);
  return match?.[1] ? cleanSignalFragment(match[1], 40) : null;
}

function inferTaskTitle(log: SentinelEvent): string {
  const text = `${log.title} ${log.content}`;
  const subject = cleanSignalFragment(log.content || log.title, 78);
  const person = log.source === "screen_text"
    ? contactFromScreenText(log.content) || contactFromTitle(log.title)
    : contactFromTitle(log.title);

  if (log.source === "calendar") return `Prepare for ${cleanSignalFragment(log.title, 64)}`;
  if (isMissedCallSignal(log)) return `Return missed call from ${person}`;
  if (/\b(reply|respond|text back|message back)\b/i.test(text)) return `Reply to ${person}`;
  if (/\b(pay|rent|invoice|bill)\b/i.test(text)) return `Pay or confirm: ${subject}`;
  if (/\b(send|submit|email)\b/i.test(text)) return `Send or submit: ${subject}`;
  if (/\b(pickup|pick up|bring)\b/i.test(text)) return `Prepare item: ${subject}`;
  if (/\b(call\s+(me|back|them|him|her|us|[a-z])|phone)\b/i.test(text)) return `Call back: ${person}`;
  if (/\b(appointment|meeting|meet|reservation|shift)\b/i.test(text)) return `Prepare for: ${subject}`;
  return `Handle: ${subject}`;
}

function firstActionForSignal(log: SentinelEvent): string {
  const person = log.source === "screen_text"
    ? contactFromScreenText(log.content) || contactFromTitle(log.title)
    : contactFromTitle(log.title);
  const text = `${log.title} ${log.content}`;
  if (log.source === "calendar") return "Open the calendar event and put the first required item in one visible place.";
  if (isMissedCallSignal(log)) return `Open Phone and return the missed call from ${person}.`;
  if (/\b(reply|respond|text back|message back)\b/i.test(text)) return `Open the message thread with ${person} and write the shortest useful reply.`;
  if (/\b(pay|rent|invoice|bill)\b/i.test(text)) return "Open the payment or account page and confirm the amount due.";
  if (/\b(send|submit|email)\b/i.test(text)) return "Open the needed app and attach or send the requested item.";
  if (/\b(pickup|pick up|bring)\b/i.test(text)) return "Put the named item in one visible place now.";
  return "Open the source app and do only the requested action.";
}

export function buildTaskFromSignal(rawLog: SentinelEvent, index = 0, now = Date.now()): ExecutiveTask | null {
  const log = normalizeSignal(rawLog, index, now);
  if (!isTaskCandidateSignal(log, now)) return null;
  const id = `task-${Date.now()}-${index}`;
  const title = inferTaskTitle(log);
  const nextPhysicalAction = firstActionForSignal(log);
  const contentStep = cleanSignalFragment(log.content || log.title, 80);
  const targetTime = inferTargetTimeFromSignal(log);

  if (log.source === "calendar") {
    return {
      id,
      title,
      estimatedDurationMinutes: 30,
      isCompleted: false,
      targetTime,
      avoidanceTarget: "Rereading the event instead of preparing what it requires",
      nextPhysicalAction,
      steps: [
        { id: `${id}-1`, title: "Open the calendar event", durationMinutes: 5, state: "current" },
        { id: `${id}-2`, title: "Find the location, time, and required item", durationMinutes: 10, state: "pending" },
        { id: `${id}-3`, title: "Put the first required item where you can see it", durationMinutes: 15, state: "pending" }
      ]
    };
  }

  if (isMissedCallSignal(log)) {
    return {
      id,
      title,
      estimatedDurationMinutes: 10,
      isCompleted: false,
      targetTime,
      avoidanceTarget: "Checking unrelated notifications before returning the call",
      nextPhysicalAction,
      steps: [
        { id: `${id}-1`, title: "Open Phone", durationMinutes: 2, state: "current" },
        { id: `${id}-2`, title: `Call or message ${contactFromTitle(log.title)}`, durationMinutes: 5, state: "pending" },
        { id: `${id}-3`, title: "Write down any follow-up from the call", durationMinutes: 3, state: "pending" }
      ]
    };
  }

  return {
    id,
    title,
    estimatedDurationMinutes: 15,
    isCompleted: false,
    targetTime,
    avoidanceTarget: "Opening unrelated apps before finishing this one action",
    nextPhysicalAction,
    steps: [
      { id: `${id}-1`, title: "Open the source app or thread", durationMinutes: 3, state: "current" },
      { id: `${id}-2`, title: `Act on: ${contentStep}`, durationMinutes: 9, state: "pending" },
      { id: `${id}-3`, title: "Close the loop and return here", durationMinutes: 3, state: "pending" }
    ]
  };
}

export function extractTasksHeuristic(logs: Array<SentinelEvent | any>, now = Date.now()): ExecutiveTask[] {
  const seen = new Set<string>();
  const tasks: ExecutiveTask[] = [];
  const normalizedLogs = logs.map((log, index) => normalizeSignal(log, index, now));
  for (const log of taskSignals(normalizedLogs, now)) {
    const task = buildTaskFromSignal(log, tasks.length, now);
    if (!task) continue;
    const key = task.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tasks.push(task);
    if (tasks.length >= 4) break;
  }
  return tasks;
}

function coerceUrgency(value: unknown): TaskUrgency | undefined {
  return value === "now" || value === "soon" || value === "later" ? value : undefined;
}

function coerceStringIdArray(value: unknown, max = 12): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value
    .filter(item => typeof item === "string" && item.trim().length > 0)
    .map(item => String(item).trim().slice(0, 180))
    .slice(0, max);
  return ids.length > 0 ? ids : undefined;
}

export function normalizeTask(raw: any, index = 0): ExecutiveTask | null {
  if (!raw || looksLikePlaceholderTask(raw)) return null;
  const title = cleanSignalFragment(String(raw.title || ""), 96);
  if (!title || title === "phone signal") return null;
  const steps = Array.isArray(raw.steps) && raw.steps.length > 0
    ? raw.steps.slice(0, 5).map((step: any, stepIndex: number) => ({
        id: String(step.id || `generated-step-${Date.now()}-${index}-${stepIndex}`),
        title: cleanSignalFragment(String(step.title || `Step ${stepIndex + 1}`), 90),
        durationMinutes: Math.max(1, Number(step.durationMinutes || 5)),
        state: stepIndex === 0 ? "current" as const : "pending" as const
      }))
    : [
        { id: `generated-step-${Date.now()}-${index}-0`, title: "Open the source app or event", durationMinutes: 3, state: "current" as const },
        { id: `generated-step-${Date.now()}-${index}-1`, title: "Complete the requested action", durationMinutes: 10, state: "pending" as const }
      ];

  const task: ExecutiveTask = {
    id: String(raw.id || `generated-task-${Date.now()}-${index}`),
    title,
    estimatedDurationMinutes: Math.max(5, Number(raw.estimatedDurationMinutes || 15)),
    isCompleted: false,
    targetTime: coerceTimeString(raw.targetTime),
    associatedAnchorId: raw.associatedAnchorId || null,
    avoidanceTarget: cleanSignalFragment(String(raw.avoidanceTarget || "Opening unrelated apps before this is handled"), 120),
    nextPhysicalAction: cleanSignalFragment(String(raw.nextPhysicalAction || "Open the source app and do the requested action."), 140),
    steps
  };
  const why = typeof raw.why === "string" && raw.why.trim() ? String(raw.why).replace(/\s+/g, " ").trim().slice(0, 280) : undefined;
  if (why) task.why = why;
  const urgency = coerceUrgency(raw.urgency);
  if (urgency) task.urgency = urgency;
  const sourceLogIds = coerceStringIdArray(raw.sourceLogIds);
  if (sourceLogIds) task.sourceLogIds = sourceLogIds;
  if (typeof raw.situationId === "string" && raw.situationId.trim()) task.situationId = raw.situationId.trim().slice(0, 180);
  return task;
}

// Server-side gate for AI-authored task arrays. Normalizes every item, then strips any
// traceability ids the model did not receive in the request — prompt-injected content in a
// message body cannot forge links to signals or situations that were never sent.
export function sanitizeExtractedTasks(
  rawItems: unknown,
  knownLogIds: Set<string>,
  knownSituationIds: Set<string>
): ExecutiveTask[] {
  if (!Array.isArray(rawItems)) return [];
  const tasks: ExecutiveTask[] = [];
  for (const raw of rawItems) {
    const task = normalizeTask(raw, tasks.length);
    if (!task) continue;
    if (task.sourceLogIds) {
      const kept = task.sourceLogIds.filter(id => knownLogIds.has(id));
      if (kept.length > 0) task.sourceLogIds = kept;
      else delete task.sourceLogIds;
    }
    if (task.situationId && !knownSituationIds.has(task.situationId)) delete task.situationId;
    tasks.push(task);
    if (tasks.length >= 6) break;
  }
  return tasks;
}

// Validates a StoredTask coming from a client or from Postgres WITHOUT resetting live
// progress: unlike normalizeTask (which builds fresh suggestions), this preserves
// isCompleted, per-step states, status, and timestamps so sync round-trips are lossless.
export function normalizeStoredTask(raw: any, now = Date.now()): StoredTask | null {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 180) : "";
  const title = String(raw.title || "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (!id || !title) return null;

  const stepStates = new Set(["current", "pending", "done"]);
  const steps = Array.isArray(raw.steps)
    ? raw.steps.slice(0, 8).map((step: any, stepIndex: number) => ({
        id: typeof step?.id === "string" && step.id.trim() ? step.id.trim().slice(0, 180) : `${id}-step-${stepIndex}`,
        title: String(step?.title || `Step ${stepIndex + 1}`).replace(/\s+/g, " ").trim().slice(0, 140),
        durationMinutes: Math.max(1, Number(step?.durationMinutes || 5)),
        state: stepStates.has(step?.state) ? step.state as "current" | "pending" | "done" : "pending" as const
      }))
    : [];

  const isCompleted = raw.isCompleted === true;
  const status: StoredTaskStatus = raw.status === "open" || raw.status === "done" || raw.status === "dismissed"
    ? raw.status
    : (isCompleted ? "done" : "open");
  const updatedAtEpochMillis = Number.isFinite(Number(raw.updatedAtEpochMillis)) && Number(raw.updatedAtEpochMillis) > 0
    ? Number(raw.updatedAtEpochMillis)
    : now;
  const createdAtEpochMillis = Number.isFinite(Number(raw.createdAtEpochMillis)) && Number(raw.createdAtEpochMillis) > 0
    ? Number(raw.createdAtEpochMillis)
    : updatedAtEpochMillis;

  const task: StoredTask = {
    id,
    title,
    estimatedDurationMinutes: Math.max(1, Number(raw.estimatedDurationMinutes || 15)),
    isCompleted: status === "done" ? true : isCompleted,
    targetTime: coerceTimeString(raw.targetTime),
    associatedAnchorId: raw.associatedAnchorId || null,
    avoidanceTarget: String(raw.avoidanceTarget || "").replace(/\s+/g, " ").trim().slice(0, 160),
    nextPhysicalAction: String(raw.nextPhysicalAction || "").replace(/\s+/g, " ").trim().slice(0, 180),
    steps,
    status,
    createdAtEpochMillis,
    updatedAtEpochMillis,
    completedAtEpochMillis: Number.isFinite(Number(raw.completedAtEpochMillis)) && Number(raw.completedAtEpochMillis) > 0
      ? Number(raw.completedAtEpochMillis)
      : (status === "done" ? updatedAtEpochMillis : null)
  };
  const why = typeof raw.why === "string" && raw.why.trim() ? String(raw.why).replace(/\s+/g, " ").trim().slice(0, 280) : undefined;
  if (why) task.why = why;
  const urgency = coerceUrgency(raw.urgency);
  if (urgency) task.urgency = urgency;
  const sourceLogIds = coerceStringIdArray(raw.sourceLogIds);
  if (sourceLogIds) task.sourceLogIds = sourceLogIds;
  if (typeof raw.situationId === "string" && raw.situationId.trim()) task.situationId = raw.situationId.trim().slice(0, 180);
  return task;
}

// Newer-wins merge by task id (updatedAtEpochMillis decides). Used by both the server
// (POST /api/tasks) and the client sync layer so the two sides converge on the same result.
export function mergeStoredTasks(current: StoredTask[], incoming: StoredTask[], cap = 200): StoredTask[] {
  const byId = new Map<string, StoredTask>();
  for (const task of current) byId.set(task.id, task);
  for (const task of incoming) {
    const existing = byId.get(task.id);
    if (!existing || task.updatedAtEpochMillis >= existing.updatedAtEpochMillis) byId.set(task.id, task);
  }
  return Array.from(byId.values())
    .sort((a, b) => b.updatedAtEpochMillis - a.updatedAtEpochMillis)
    .slice(0, cap);
}
