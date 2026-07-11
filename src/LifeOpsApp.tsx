import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Crosshair,
  Inbox,
  ListChecks,
  MessageSquare,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TimerReset,
  Trash2,
  X,
  Zap
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ExecutiveTask, SentinelEvent, SlipAutopsy, StoredTask } from "./types";
import { formatTo12Hour, generateReverseTimeline, minutesToTimeString } from "./cartographer";
import { Pill, StatTile } from "./components/ui";
import { FocusMode } from "./components/FocusMode";
import { SmartSuggestionCard } from "./components/SmartSuggestionCard";
import { TaskList } from "./components/TaskList";
import {
  buildLocalRelevanceAudit,
  buildSmartSituations,
  type DecisionFeedbackKind,
  type DecisionFeedbackMap,
  type RelevanceAudit,
  type SmartSituation,
  smartTasksFromSituations,
} from "./decisionEngine";
import {
  buildTaskFromSignal,
  cleanSignalFragment,
  coerceTimeString,
  displaySignals,
  extractTasksHeuristic,
  isClinicalContent,
  isDistractionSignal,
  isSystemAppUsageSignal,
  isTaskCandidateSignal,
  looksLikePlaceholderTask,
  MAX_STORED_ITEMS,
  mergeStoredTasks,
  migrateStoredState,
  normalizeSignal,
  normalizeStoredTask,
  normalizeTask,
  signalReason,
  taskSignals,
} from "./lifeopsRules";

type SentinelAndroidBridge = {
  getBridgeStatusJson: () => string;
  getTelemetryJson: () => string;
  refreshTelemetryJson?: () => string;
  exportTelemetrySnapshotJson?: (baseUrl: string, token: string, forceRefresh: boolean) => string;
  addTelemetryJson: (payloadJson: string) => string;
  extractTasksJson: (logsJson: string) => string;
  openSourceApp?: (packageName: string, source?: string) => void;
  requestRuntimePermissions: () => void;
  openUsageAccessSettings: () => void;
  openNotificationAccessSettings: () => void;
  openAccessibilitySettings: () => void;
  openAppSettings: () => void;
};

type AppTab = "today" | "signals" | "tasks" | "access";
type Notice = { text: string; severity: "info" | "warning" | "error" };
type PermissionItem = {
  key: string;
  label: string;
  detail: string;
  isReady: boolean;
  actionLabel: string;
  onAction?: () => void;
};

declare global {
  interface Window {
    SentinelAndroid?: SentinelAndroidBridge;
  }
}

function parseBridgeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn("Android bridge returned invalid JSON:", err);
    return fallback;
  }
}

function loadStoredArray<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function saveStoredArray<T>(key: string, value: T[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value.slice(0, MAX_STORED_ITEMS)));
  } catch {
    // Local persistence is helpful, but the app should keep running without it.
  }
}

function loadStoredRecord<T>(key: string): Record<string, T> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveStoredRecord<T>(key: string, value: Record<string, T>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Feedback is optional; the cockpit should keep running without it.
  }
}

function dedupeSignals(logs: SentinelEvent[]): SentinelEvent[] {
  const seen = new Set<string>();
  const output: SentinelEvent[] = [];
  for (const log of logs) {
    if (isClinicalContent(`${log.title} ${log.content}`)) continue;
    const key = log.id || `${log.source}:${log.title}:${log.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(log);
  }
  return output
    .sort((a, b) => (b.capturedAtEpochMillis || 0) - (a.capturedAtEpochMillis || 0))
    .slice(0, MAX_STORED_ITEMS);
}

function formatRelativeTime(epoch?: number): string {
  if (!epoch) return "unknown";
  const diff = Date.now() - epoch;
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function sourceLabel(source: SentinelEvent["source"]): string {
  if (source === "app_usage") return "App usage";
  if (source === "screen_text") return "Screen text";
  if (source === "user_note") return "Manual note";
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function sourceIcon(source: SentinelEvent["source"]) {
  if (source === "sms") return MessageSquare;
  if (source === "calendar") return CalendarDays;
  if (source === "screen_text") return Smartphone;
  if (source === "app_usage") return Smartphone;
  if (source === "location") return Zap;
  return Bell;
}

function primaryButtonClass(tone: "cyan" | "ai" | "green" | "amber" | "slate" | "red" = "cyan") {
  const map = {
    cyan: "bg-primary text-primary-ink hover:opacity-90 border-transparent",
    ai: "bg-accent text-[#0a1030] hover:opacity-90 border-transparent",
    green: "bg-emerald-500 text-slate-950 hover:bg-emerald-400 border-emerald-400",
    amber: "bg-amber-400 text-slate-950 hover:bg-amber-300 border-amber-300",
    slate: "bg-surface-raised text-ink hover:bg-slate-700 border-line",
    red: "bg-rose-500 text-ink hover:bg-rose-400 border-rose-400"
  };
  return `${map[tone]} border rounded-xl px-4 py-3 text-left font-semibold transition-colors disabled:opacity-45 disabled:cursor-not-allowed`;
}

function ActionButton({
  icon: Icon,
  label,
  hint,
  tone = "cyan",
  disabled,
  onClick
}: {
  icon: React.ElementType;
  label: string;
  hint?: string;
  tone?: "cyan" | "ai" | "green" | "amber" | "slate" | "red";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} disabled={disabled} className={`${primaryButtonClass(tone)} flex items-center gap-3 min-h-[58px]`}>
      <Icon className="h-5 w-5 shrink-0" />
      <span className="min-w-0">
        <span className="block text-sm leading-tight">{label}</span>
        {hint && <span className="block text-xs font-medium opacity-75 leading-snug mt-0.5">{hint}</span>}
      </span>
    </button>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/40 p-5">
      <h3 className="text-base font-bold text-slate-100">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{body}</p>
    </div>
  );
}

function buildLocalAskAnswer(question: string, situations: SmartSituation[], signals: SentinelEvent[]): string {
  const top = situations[0];
  if (!top) {
    return signals.length > 0
      ? "I can see phone context, but the local rules do not see a concrete task yet. Look for a message, missed call, visible app text, calendar event, or notification with a request, deadline, or time."
      : "There is no phone data loaded yet. Refresh phone data first, then ask again.";
  }

  const lower = question.toLowerCase();
  if (/\b(urgent|now|first|priority|important|next)\b/.test(lower)) {
    return `The strongest next item is "${top.title}". Priority ${Math.round(top.priorityScore)}, ${top.confidence} confidence, ${top.urgency} urgency. First action: ${top.recommendedAction}`;
  }

  if (/\b(why|reason|evidence|source)\b/.test(lower)) {
    return `${top.title}: ${top.why.join(" ")} Evidence: ${top.evidence.join(" | ")}`;
  }

  if (/\b(ignore|not task|noise|app|call)\b/.test(lower)) {
    const contextCount = signals.filter(signal => !isTaskCandidateSignal(signal)).length;
    return `${contextCount} recent signals are being kept as context only. App usage and ordinary incoming/outgoing call durations do not create tasks unless there is a missed call or a concrete request.`;
  }

  return situations.slice(0, 3)
    .map((situation, index) => `${index + 1}. ${situation.title} (${situation.confidence}, ${situation.urgency}) - ${situation.why[0]}`)
    .join("\n");
}

function auditEngineLabel(engine: RelevanceAudit["engine"]) {
  if (engine === "claude-agent-sdk") return "Claude Opus";
  if (engine === "claude-sdk") return "Claude Sonnet";
  if (engine === "claude-code-cli") return "Claude Code";
  if (engine === "deepseek") return "DeepSeek";
  return "local rules";
}

function shortServerWarning(value: unknown) {
  const raw = typeof value === "string" ? value : "";
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.result === "string") return parsed.result;
  } catch {
    // Keep the raw warning when the server returned plain text.
  }
  return raw.length > 180 ? `${raw.slice(0, 177)}...` : raw;
}

function clipForClaudeCheck(value: string | undefined | null, maxLength: number) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function compactSignalForClaudeCheck(signal: SentinelEvent) {
  return {
    id: signal.id,
    timestamp: signal.timestamp,
    source: signal.source,
    title: clipForClaudeCheck(signal.title, 120),
    content: clipForClaudeCheck(signal.content, 260),
    relevanceScore: signal.relevanceScore,
    relevanceReason: clipForClaudeCheck(signal.relevanceReason, 160),
    capturedAtEpochMillis: signal.capturedAtEpochMillis,
    packageName: signal.packageName,
  };
}

// Task extraction needs the situation PLUS its evidence signals (id + clipped content)
// so the model can quote real message text in the why-line and copy real signal ids
// into sourceLogIds. The relevance-check compaction omits signal bodies on purpose.
function compactSituationForTaskExtraction(situation: SmartSituation) {
  return {
    ...compactSituationForClaudeCheck(situation),
    signals: situation.signals.slice(0, 6).map(compactSignalForClaudeCheck),
  };
}

function compactSituationForClaudeCheck(situation: SmartSituation) {
  return {
    id: situation.id,
    fingerprint: situation.fingerprint,
    title: clipForClaudeCheck(situation.title, 140),
    priorityScore: situation.priorityScore,
    confidence: situation.confidence,
    urgency: situation.urgency,
    sourceSummary: situation.sourceSummary,
    recommendedAction: clipForClaudeCheck(situation.recommendedAction, 180),
    why: situation.why.slice(0, 3).map(item => clipForClaudeCheck(item, 180)),
    evidence: situation.evidence.slice(0, 3).map(item => clipForClaudeCheck(item, 180)),
    task: {
      id: situation.task.id,
      title: clipForClaudeCheck(situation.task.title, 140),
      targetTime: situation.task.targetTime,
      nextPhysicalAction: clipForClaudeCheck(situation.task.nextPhysicalAction, 160),
    },
    signalIds: situation.signals.slice(0, 8).map(signal => signal.id),
  };
}

function compactTaskForClaudeCheck(task: ExecutiveTask) {
  return {
    id: task.id,
    title: clipForClaudeCheck(task.title, 140),
    targetTime: task.targetTime,
    avoidanceTarget: clipForClaudeCheck(task.avoidanceTarget, 140),
    nextPhysicalAction: clipForClaudeCheck(task.nextPhysicalAction, 160),
    steps: task.steps.slice(0, 4).map(step => ({
      id: step.id,
      title: clipForClaudeCheck(step.title, 120),
      durationMinutes: step.durationMinutes,
      state: step.state,
    })),
  };
}

export default function LifeOpsApp() {
  migrateStoredState();

  const androidBridge = typeof window !== "undefined" ? window.SentinelAndroid : undefined;
  const isAndroidBridgeAvailable = Boolean(androidBridge);
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const ingestToken = viteEnv?.VITE_SENTINEL_INGEST_TOKEN || "";
  const askApiBase = (viteEnv?.VITE_PUBLIC_INGEST_BASE_URL || "").replace(/\/$/, "");
  const canUseLifeOpsServer = !androidBridge || Boolean(askApiBase);
  const [activeTab, setActiveTab] = useState<AppTab>("today");
  const [currentClock, setCurrentClock] = useState(() => new Date());
  const [storedTasks, setStoredTasks] = useState<StoredTask[]>(() => {
    const current = loadStoredArray<StoredTask>("sentinel-lifeops:tasks")
      .map(task => normalizeStoredTask(task))
      .filter((task): task is StoredTask => task !== null);
    if (current.length > 0) return current;
    // One-time fold of the legacy active-task store (left in place for rollback).
    return loadStoredArray<ExecutiveTask>("sentinel-lifeops:activeTasks")
      .filter(task => !looksLikePlaceholderTask(task))
      .map(task => normalizeStoredTask({ ...task, status: task.isCompleted ? "done" : "open" }))
      .filter((task): task is StoredTask => task !== null);
  });
  const [sentinelFeed, setSentinelFeed] = useState<SentinelEvent[]>(() => dedupeSignals(loadStoredArray<SentinelEvent>("sentinel-lifeops:sentinelFeed").map((log, index) => normalizeSignal(log, index))));
  const [slipAutopsies, setSlipAutopsies] = useState<SlipAutopsy[]>(() => loadStoredArray<SlipAutopsy>("sentinel-lifeops:slipAutopsies"));
  const [extractedTasks, setExtractedTasks] = useState<ExecutiveTask[]>(() => loadStoredArray<ExecutiveTask>("sentinel-lifeops:extractedTasks").map(normalizeTask).filter(Boolean) as ExecutiveTask[]);
  const [signalFeedback, setSignalFeedback] = useState<DecisionFeedbackMap>(() => loadStoredRecord("sentinel-lifeops:signalFeedback") as DecisionFeedbackMap);
  const [suppressedSignalIds, setSuppressedSignalIds] = useState<Record<string, boolean>>(() => loadStoredRecord("sentinel-lifeops:suppressedSignalIds") as Record<string, boolean>);
  const [relevanceAudit, setRelevanceAudit] = useState<RelevanceAudit | null>(null);
  const [selectedAuditIds, setSelectedAuditIds] = useState<Record<string, boolean>>({});
  const [isExtractingTasks, setIsExtractingTasks] = useState(false);
  const [isCheckingRelevance, setIsCheckingRelevance] = useState(false);
  const [askQuestion, setAskQuestion] = useState("");
  const [askAnswer, setAskAnswer] = useState("");
  const [askEngine, setAskEngine] = useState<RelevanceAudit["engine"] | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [serverHealth, setServerHealth] = useState<{
    modelProvider?: string;
    modelRuntimeStatus?: string;
    model?: string | null;
    claudeLastError?: string | null;
    claudeLastSuccessAt?: string | null;
    claudeLastProvider?: string | null;
    mode?: string;
    bindHost?: string;
    dbPersistent?: boolean;
    ingestAuthRequired?: boolean;
    aiAuth?: {
      anthropicKeyPresent?: boolean;
      anthropicKeyLooksLikeApiKey?: boolean;
      anthropicCredentialShape?: string;
      anthropicAuthTokenPresent?: boolean;
      deepseekKeyPresent?: boolean;
      claudeCodeCliConfigured?: boolean;
      lastProviderUsed?: string | null;
    };
  } | null>(null);
  const [androidBridgeStatus, setAndroidBridgeStatus] = useState<Record<string, any> | null>(null);
  const [notice, setNotice] = useState<Notice | null>({ text: "Ready. Refresh phone data, then pick one real task when a useful signal appears.", severity: "info" });
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [showStuckPanel, setShowStuckPanel] = useState(false);
  const [showDelayModal, setShowDelayModal] = useState(false);
  const [showBridgeDiagnostics, setShowBridgeDiagnostics] = useState(false);
  const [focusModeOpen, setFocusModeOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDuration, setNewTaskDuration] = useState(15);
  const [newTaskNextPhysical, setNewTaskNextPhysical] = useState("");
  const [newTaskTargetTime, setNewTaskTargetTime] = useState("");
  const [newStepsInput, setNewStepsInput] = useState("");
  const [manualSignalSource, setManualSignalSource] = useState<SentinelEvent["source"]>("user_note");
  const [manualSignalTitle, setManualSignalTitle] = useState("");
  const [manualSignalContent, setManualSignalContent] = useState("");
  const [quickNoteText, setQuickNoteText] = useState("");
  const [taskTargetOverrides, setTaskTargetOverrides] = useState<Record<string, string>>({});
  const [slipWhat, setSlipWhat] = useState("");
  const [slipExpected, setSlipExpected] = useState(15);
  const [slipActual, setSlipActual] = useState(30);
  const [slipHiddenSteps, setSlipHiddenSteps] = useState("");
  const [slipFix, setSlipFix] = useState("");
  const lastAutoExtractKeyRef = useRef("");
  const lastTimelineNoticeKeyRef = useRef("");
  const storedTasksRef = useRef(storedTasks);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    storedTasksRef.current = storedTasks;
  }, [storedTasks]);

  const activeTask = storedTasks.find(task => task.status === "open" && !task.isCompleted) || null;
  const nextStep = activeTask?.steps.find(step => step.state === "current") || activeTask?.steps.find(step => step.state === "pending") || null;
  const currentMinutes = currentClock.getHours() * 60 + currentClock.getMinutes();
  const displayCurrentTime = minutesToTimeString(currentMinutes);
  const activeFeed = useMemo(() => sentinelFeed.filter(log => !suppressedSignalIds[log.id]), [sentinelFeed, suppressedSignalIds]);
  const taskReadySignals = useMemo(() => taskSignals(activeFeed, currentClock.getTime()), [activeFeed, currentClock]);
  const visibleSignals = useMemo(() => displaySignals(activeFeed, currentClock.getTime()), [activeFeed, currentClock]);
  const smartSituations = useMemo(() => buildSmartSituations(activeFeed, signalFeedback, currentClock.getTime()), [activeFeed, signalFeedback, currentClock]);
  const smartSituationByTaskId = useMemo(() => {
    const map = new Map<string, SmartSituation>();
    for (const situation of smartSituations) {
      map.set(situation.task.id, situation);
      map.set(situation.id, situation);
    }
    return map;
  }, [smartSituations]);
  const visibleSuggestionTasks = useMemo(() => {
    const tasks = extractedTasks.length > 0 ? extractedTasks : smartTasksFromSituations(smartSituations);
    const seen = new Set<string>();
    return tasks.filter(task => {
      const key = `${task.associatedAnchorId || task.id}:${task.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [extractedTasks, smartSituations]);
  const driftSignal = useMemo(() => {
    if (!activeTask) return null;
    return activeFeed
      .filter(log => log.source === "app_usage" && !isSystemAppUsageSignal(log) && isDistractionSignal(`${log.title} ${log.content}`))
      .sort((a, b) => (b.capturedAtEpochMillis || 0) - (a.capturedAtEpochMillis || 0))[0] || null;
  }, [activeTask, activeFeed]);
  const telemetryCounts = useMemo(() => activeFeed.reduce<Record<string, number>>((counts, item) => {
    counts[item.source] = (counts[item.source] || 0) + 1;
    return counts;
  }, {}), [activeFeed]);
  const lastSignalTime = activeFeed[0]?.capturedAtEpochMillis;
  const selectedAuditCount = relevanceAudit?.items.filter(item => selectedAuditIds[item.id]).length || 0;

  const timeline = useMemo(() => {
    if (!activeTask?.targetTime) return { reverseSteps: [], hardLeaveMinutes: null as number | null, prepStartMinutes: null as number | null };
    return generateReverseTimeline(activeTask.targetTime, activeTask.steps, 20, 15);
  }, [activeTask]);

  const hardLeaveLabel = typeof timeline.hardLeaveMinutes === "number"
    ? formatTo12Hour(minutesToTimeString(timeline.hardLeaveMinutes))
    : "not set";
  const prepStartLabel = typeof timeline.prepStartMinutes === "number"
    ? formatTo12Hour(minutesToTimeString(timeline.prepStartMinutes))
    : "not set";

  const refreshAndroidStatus = useCallback(() => {
    if (!androidBridge) return;
    setAndroidBridgeStatus(parseBridgeJson(androidBridge.getBridgeStatusJson(), null));
  }, [androidBridge]);

  const taskAuthHeaders = useMemo(() => ({
    "Content-Type": "application/json",
    ...(ingestToken ? { "X-Sentinel-Ingest-Token": ingestToken } : {})
  }), [ingestToken]);

  // Fire-and-forget push of one task's state. A lost PATCH self-heals: the next full
  // sync sees the locally-newer record and POSTs it. 404 means the server never saw
  // this task (created offline), so upload it whole.
  const pushTaskToServer = useCallback((task: StoredTask) => {
    if (!canUseLifeOpsServer) return;
    void fetch(`${askApiBase || ""}/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      headers: taskAuthHeaders,
      body: JSON.stringify({
        status: task.status,
        isCompleted: task.isCompleted,
        steps: task.steps,
        targetTime: task.targetTime ?? null,
        updatedAtEpochMillis: task.updatedAtEpochMillis
      })
    }).then(response => {
      if (response.status === 404) {
        return fetch(`${askApiBase || ""}/api/tasks`, {
          method: "POST",
          headers: taskAuthHeaders,
          body: JSON.stringify({ tasks: [task] })
        });
      }
      return response;
    }).catch(() => {
      // Offline is fine; the periodic sync converges later.
    });
  }, [askApiBase, canUseLifeOpsServer, taskAuthHeaders]);

  // Two-way task sync: server list + local list, newer-wins per id, then the merged
  // result is pushed back so both sides converge on the same state.
  const syncTasksWithServer = useCallback(async () => {
    if (!canUseLifeOpsServer) return;
    try {
      const response = await fetch(`${askApiBase || ""}/api/tasks`, {
        headers: ingestToken ? { "X-Sentinel-Ingest-Token": ingestToken } : undefined
      });
      if (!response.ok) return;
      const data = await response.json().catch(() => null);
      const serverTasks = (Array.isArray(data?.tasks) ? data.tasks : [])
        .map((item: unknown) => normalizeStoredTask(item))
        .filter((task: StoredTask | null): task is StoredTask => task !== null);
      const merged = mergeStoredTasks(storedTasksRef.current, serverTasks);
      setStoredTasks(merged);
      if (merged.length > 0) {
        void fetch(`${askApiBase || ""}/api/tasks`, {
          method: "POST",
          headers: taskAuthHeaders,
          body: JSON.stringify({ tasks: merged.slice(0, 50) })
        }).catch(() => {});
      }
    } catch {
      // Unreachable server just means local-only until the next sync.
    }
  }, [askApiBase, canUseLifeOpsServer, ingestToken, taskAuthHeaders]);

  // Every task mutation flows through here: normalize, stamp updatedAt, merge into
  // local state (newer-wins keeps ordering consistent), persist to the server.
  const applyTaskChange = useCallback((task: StoredTask, changes: Partial<StoredTask>): StoredTask | null => {
    const next = normalizeStoredTask({ ...task, ...changes, updatedAtEpochMillis: Date.now() });
    if (!next) return null;
    setStoredTasks(prev => mergeStoredTasks(prev, [next]));
    pushTaskToServer(next);
    return next;
  }, [pushTaskToServer]);

  const pushTelemetryExport = useCallback(async (logs: SentinelEvent[], forceRefresh: boolean) => {
    if (!androidBridge || logs.length === 0) return "";
    if (!canUseLifeOpsServer) {
      return " Phone data is local only; set VITE_PUBLIC_INGEST_BASE_URL so CBT Sentinel can read it.";
    }

    try {
      if (androidBridge.exportTelemetrySnapshotJson) {
        const rawResult = androidBridge.exportTelemetrySnapshotJson(askApiBase, ingestToken, forceRefresh);
        const nativeResult = parseBridgeJson<{
          success?: boolean;
          exported?: number;
          status?: number;
          error?: string;
        } | null>(rawResult, null);
        if (nativeResult?.success) {
          return ` Exported ${nativeResult.exported ?? logs.length} to the LifeOps server for CBT Sentinel.`;
        }
        console.warn("Native telemetry export failed; falling back to WebView fetch:", nativeResult);
      }

      const response = await fetch(`${askApiBase || ""}/api/telemetry/bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(ingestToken ? { "X-Sentinel-Ingest-Token": ingestToken } : {})
        },
        body: JSON.stringify({ logs })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error || `HTTP ${response.status}`);
      }
      return ` Exported ${result?.imported ?? logs.length} to the LifeOps server for CBT Sentinel.`;
    } catch (err) {
      console.warn("Telemetry export failed:", err);
      if (forceRefresh) {
        setNotice({
          text: `Phone data loaded locally, but export to the LifeOps server failed: ${err instanceof Error ? err.message : "unknown error"}.`,
          severity: "error"
        });
      }
      return " Export to the LifeOps server failed.";
    }
  }, [androidBridge, askApiBase, canUseLifeOpsServer, ingestToken]);

  const syncTelemetryLogs = useCallback(async (forceRefresh = false) => {
    setIsSyncing(true);
    try {
      let data: { logs?: SentinelEvent[]; lookbackHours?: number; historyCoverage?: string } | null = null;
      if (androidBridge) {
        const raw = forceRefresh && androidBridge.refreshTelemetryJson
          ? androidBridge.refreshTelemetryJson()
          : androidBridge.getTelemetryJson();
        data = parseBridgeJson(raw, null);
      } else {
        const response = await fetch("/api/telemetry", {
          headers: ingestToken ? { "X-Sentinel-Ingest-Token": ingestToken } : undefined
        });
        if (response.ok) {
          data = await response.json();
        } else if (response.status === 401) {
          setNotice({ text: "Telemetry is token-protected. Set VITE_SENTINEL_INGEST_TOKEN or use the Android bridge.", severity: "warning" });
        }
      }

      if (!data?.logs || !Array.isArray(data.logs)) {
        if (forceRefresh) setNotice({ text: "No phone data came back from the bridge yet. Check Access.", severity: "warning" });
        return;
      }

      const incoming = data.logs.map((log, index) => normalizeSignal(log, index)).filter(log => !suppressedSignalIds[log.id]);
      const exportLabel = await pushTelemetryExport(incoming, forceRefresh);
      setSentinelFeed(prev => {
        const next = forceRefresh && androidBridge ? dedupeSignals(incoming) : dedupeSignals([...incoming, ...prev]);
        const newCount = next.filter(item => !prev.some(existing => existing.id === item.id)).length;
        if (forceRefresh || newCount > 0) {
          const actionable = taskSignals(next).length;
          const scopeLabel = data.lookbackHours ? ` from a ${data.lookbackHours}-hour scan` : "";
          const coverageLabel = data.historyCoverage ? ` ${data.historyCoverage}` : "";
          // Periodic sync messages must never clobber an unacknowledged error.
          setNotice(prev => (!forceRefresh && prev?.severity === "error") ? prev : {
            text: `${forceRefresh ? "Refreshed" : "Added"} ${newCount || incoming.length} phone signal${(newCount || incoming.length) === 1 ? "" : "s"}${scopeLabel}. ${actionable} can become task suggestions.${coverageLabel}${exportLabel}`,
            severity: actionable > 0 ? "info" : "warning"
          });
        }
        return next;
      });
      refreshAndroidStatus();
    } catch (err) {
      console.warn("Telemetry sync failed:", err);
      if (forceRefresh) setNotice({ text: "Phone data refresh failed. Open Access and check the bridge permissions.", severity: "error" });
    } finally {
      setIsSyncing(false);
    }
  }, [androidBridge, ingestToken, pushTelemetryExport, refreshAndroidStatus, suppressedSignalIds]);

  useEffect(() => {
    const tick = () => setCurrentClock(new Date());
    tick();
    const interval = window.setInterval(tick, 30000);
    return () => window.clearInterval(interval);
  }, []);

  // Routine info notices dismiss themselves; warnings and errors stay until acknowledged.
  useEffect(() => {
    if (!notice || notice.severity !== "info") return;
    const timer = window.setTimeout(() => {
      setNotice(prev => (prev === notice ? null : prev));
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Surface the AI route's health (provider + last error) on Tasks and Setup.
  useEffect(() => {
    if (!canUseLifeOpsServer || (activeTab !== "tasks" && activeTab !== "access")) return;
    let cancelled = false;
    fetch(`${askApiBase || ""}/api/health`)
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        if (!cancelled && data && typeof data === "object") setServerHealth(data);
      })
      .catch(() => {
        // An unreachable AI route is exactly what this line exists to explain;
        // show it instead of hiding the status.
        if (!cancelled) {
          setServerHealth({
            modelProvider: "unreachable",
            modelRuntimeStatus: `no response from ${askApiBase || "the local server"}`,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, askApiBase, canUseLifeOpsServer]);

  useEffect(() => {
    saveStoredArray("sentinel-lifeops:tasks", storedTasks);
    // Legacy key stays written (ExecutiveTask-compatible shape) so rolling back to an
    // older build keeps the open/done tasks.
    saveStoredArray("sentinel-lifeops:activeTasks", storedTasks.filter(task => task.status !== "dismissed"));
  }, [storedTasks]);
  useEffect(() => saveStoredArray("sentinel-lifeops:sentinelFeed", sentinelFeed), [sentinelFeed]);
  useEffect(() => saveStoredArray("sentinel-lifeops:slipAutopsies", slipAutopsies), [slipAutopsies]);
  useEffect(() => saveStoredArray("sentinel-lifeops:extractedTasks", extractedTasks), [extractedTasks]);
  useEffect(() => saveStoredRecord("sentinel-lifeops:signalFeedback", signalFeedback), [signalFeedback]);
  useEffect(() => saveStoredRecord("sentinel-lifeops:suppressedSignalIds", suppressedSignalIds), [suppressedSignalIds]);

  useEffect(() => {
    syncTelemetryLogs();
    const interval = window.setInterval(() => syncTelemetryLogs(), 45000);
    return () => window.clearInterval(interval);
  }, [syncTelemetryLogs]);

  // Task list converges with the server on boot and then periodically; local state
  // renders immediately and every mutation already pushes itself, so this is a
  // safety net for missed PATCHes and edits made from another device.
  useEffect(() => {
    syncTasksWithServer();
    const interval = window.setInterval(() => syncTasksWithServer(), 120000);
    return () => window.clearInterval(interval);
  }, [syncTasksWithServer]);

  useEffect(() => {
    refreshAndroidStatus();
    const interval = window.setInterval(refreshAndroidStatus, 10000);
    return () => window.clearInterval(interval);
  }, [refreshAndroidStatus]);

  useEffect(() => {
    if (!activeTask?.targetTime || typeof timeline.hardLeaveMinutes !== "number" || typeof timeline.prepStartMinutes !== "number") return;
    if (currentMinutes >= timeline.hardLeaveMinutes && currentMinutes < timeline.hardLeaveMinutes + 15 && !activeTask.isCompleted) {
      const windowKey = `${activeTask.id}:leave:${timeline.hardLeaveMinutes}`;
      if (lastTimelineNoticeKeyRef.current !== windowKey) {
        lastTimelineNoticeKeyRef.current = windowKey;
        setNotice({ text: `Leave time has passed. Next action: ${activeTask.nextPhysicalAction}`, severity: "error" });
      }
    } else if (currentMinutes >= timeline.prepStartMinutes && currentMinutes < timeline.prepStartMinutes + 15 && !activeTask.isCompleted) {
      const windowKey = `${activeTask.id}:prep:${timeline.prepStartMinutes}`;
      if (lastTimelineNoticeKeyRef.current !== windowKey) {
        lastTimelineNoticeKeyRef.current = windowKey;
        setNotice({ text: `Prep should start now. Next action: ${activeTask.nextPhysicalAction}`, severity: "warning" });
      }
    }
  }, [currentMinutes, activeTask, timeline.hardLeaveMinutes, timeline.prepStartMinutes]);

  const handleExtractTasks = useCallback(async (isAutomatic = false) => {
    if (taskReadySignals.length === 0) {
      if (!isAutomatic) {
        setNotice({ text: "I see phone activity, but nothing with a concrete request, missed call, screen text, deadline, or calendar event yet.", severity: "warning" });
      }
      return;
    }

    setIsExtractingTasks(true);
    try {
      let parsedTasks: ExecutiveTask[] = [];
      let aiEngine = "";
      if (isAutomatic) {
        // Auto-extract stays local: it fires every time new signals land and must not
        // burn an AI call in the background.
        parsedTasks = [];
      } else if (canUseLifeOpsServer) {
        // Server AI first: the model sees grouped situations WITH evidence text, so it
        // can word coherent tasks with a grounded why-line. The Java bridge heuristic
        // is only the offline fallback.
        try {
          const response = await fetch(`${askApiBase || ""}/api/extract-tasks`, {
            method: "POST",
            headers: taskAuthHeaders,
            body: JSON.stringify({
              situations: smartSituations.slice(0, 8).map(compactSituationForTaskExtraction),
              logs: taskReadySignals.slice(0, 30).map(compactSignalForClaudeCheck)
            })
          });
          if (response.ok) {
            const data = await response.json();
            parsedTasks = (data.results || []).map(normalizeTask).filter(Boolean) as ExecutiveTask[];
            aiEngine = String(data.engine || "");
          }
        } catch (err) {
          console.warn("Server task extraction unreachable; falling back:", err);
        }
        if (parsedTasks.length === 0 && androidBridge) {
          const data = parseBridgeJson<{ results?: any[] }>(androidBridge.extractTasksJson(JSON.stringify(taskReadySignals)), {});
          parsedTasks = (data.results || []).map(normalizeTask).filter(Boolean) as ExecutiveTask[];
        }
      } else if (androidBridge) {
        const data = parseBridgeJson<{ results?: any[] }>(androidBridge.extractTasksJson(JSON.stringify(taskReadySignals)), {});
        parsedTasks = (data.results || []).map(normalizeTask).filter(Boolean) as ExecutiveTask[];
      }

      // AI wording wins when available; situation templates and raw heuristics are
      // fallbacks (this used to be inverted, which threw the AI results away).
      const smartTasks = smartTasksFromSituations(smartSituations);
      const fallbackTasks = smartTasks.length > 0 ? smartTasks : extractTasksHeuristic(taskReadySignals);
      const nextTasks = parsedTasks.length > 0 ? parsedTasks : fallbackTasks;
      setExtractedTasks(nextTasks);
      if (!isAutomatic && nextTasks.length > 0) {
        setActiveTab("tasks");
      }
      const aiWorded = parsedTasks.length > 0 && aiEngine && aiEngine !== "local-heuristic";
      setNotice({
        text: nextTasks.length > 0
          ? `Built ${nextTasks.length} task suggestion${nextTasks.length === 1 ? "" : "s"} ${aiWorded ? `worded by ${auditEngineLabel(aiEngine as RelevanceAudit["engine"])} from grouped phone evidence` : "from actionable phone signals"}.`
          : "No real task was created. App usage and ordinary calls are being kept as context only.",
        severity: nextTasks.length > 0 ? "info" : "warning"
      });
    } catch (err) {
      console.warn("Task extraction failed:", err);
      const smartTasks = smartTasksFromSituations(smartSituations);
      const fallbackTasks = smartTasks.length > 0 ? smartTasks : extractTasksHeuristic(taskReadySignals);
      setExtractedTasks(fallbackTasks);
      setNotice({
        text: fallbackTasks.length > 0 ? "Used local task rules because the parser failed." : "The parser failed, and the local rules found no real task.",
        severity: fallbackTasks.length > 0 ? "info" : "error"
      });
    } finally {
      setIsExtractingTasks(false);
    }
  }, [androidBridge, askApiBase, canUseLifeOpsServer, smartSituations, taskAuthHeaders, taskReadySignals]);

  useEffect(() => {
    if (taskReadySignals.length === 0 || extractedTasks.length > 0 || activeTask || isExtractingTasks) return;
    const key = taskReadySignals.slice(0, 8).map(log => log.id).join("|");
    if (!key || key === lastAutoExtractKeyRef.current) return;
    const timer = window.setTimeout(() => {
      lastAutoExtractKeyRef.current = key;
      handleExtractTasks(true);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [taskReadySignals, extractedTasks.length, activeTask, isExtractingTasks, handleExtractTasks]);

  const approveTaskCandidate = (task: ExecutiveTask) => {
    const targetTime = coerceTimeString(taskTargetOverrides[task.id] || task.targetTime);
    const now = Date.now();
    const approvedTask = normalizeStoredTask({
      ...task,
      id: `active-task-${now}`,
      isCompleted: false,
      status: "open",
      targetTime,
      steps: task.steps.map((step, index) => ({ ...step, state: index === 0 ? "current" : "pending" })),
      createdAtEpochMillis: now,
      updatedAtEpochMillis: now
    });
    if (!approvedTask) {
      setNotice({ text: "That card could not become a task. Try adding it manually.", severity: "warning" });
      return;
    }
    setStoredTasks(prev => mergeStoredTasks(prev, [approvedTask]));
    pushTaskToServer(approvedTask);
    setExtractedTasks(prev => prev.filter(item => item.id !== task.id));
    setTaskTargetOverrides(prev => {
      const next = { ...prev };
      delete next[task.id];
      return next;
    });
    setActiveTab("tasks");
    setNotice({ text: targetTime ? `Current task set for ${formatTo12Hour(targetTime)}: ${task.title}` : `Current task set: ${task.title}`, severity: "info" });
  };

  const applySituationFeedback = (situation: SmartSituation, kind: DecisionFeedbackKind) => {
    setSignalFeedback(prev => ({
      ...prev,
      [situation.fingerprint]: { kind, updatedAt: Date.now() }
    }));

    if (kind === "not_task" || kind === "too_vague" || kind === "later") {
      setExtractedTasks(prev => prev.filter(task => task.id !== situation.task.id && task.associatedAnchorId !== situation.id));
    }

    const messages: Record<DecisionFeedbackKind, string> = {
      useful: "Marked useful. Similar situations will rank higher.",
      done: "Marked done as feedback. Similar situations will rank higher.",
      later: "Moved down for later.",
      too_vague: "Marked too vague. Similar suggestions will rank lower.",
      not_task: "Marked not a task. Similar situations will be suppressed.",
    };
    setNotice({ text: messages[kind], severity: kind === "not_task" || kind === "too_vague" ? "warning" : "info" });
  };

  // Card-level dismissal must share the fingerprint-suppression path with the situation
  // feedback buttons; plain removal alone lets the same suggestion resurface on the next
  // auto-extract. Plain removal remains only for AI-extracted tasks with no situation.
  const dismissTaskCard = (task: ExecutiveTask) => {
    const situation = smartSituationByTaskId.get(task.id)
      || (task.associatedAnchorId ? smartSituationByTaskId.get(task.associatedAnchorId) : undefined);
    if (situation) {
      applySituationFeedback(situation, "not_task");
      return;
    }
    setExtractedTasks(prev => prev.filter(item => item.id !== task.id));
    setNotice({ text: "Dismissed the card.", severity: "info" });
  };

  const handleCheckRelevance = async () => {
    setIsCheckingRelevance(true);
    setNotice({
      text: canUseLifeOpsServer ? "Asking the AI route to review the loaded signals once..." : "Reviewing locally. No LifeOps server is configured for this build.",
      severity: "info"
    });
    const localAudit = buildLocalRelevanceAudit(activeFeed, smartSituations);
    try {
      let audit = localAudit;
      let serverWarning = "";
      if (canUseLifeOpsServer) {
        const requestBody = {
          logs: activeFeed.slice(0, 60).map(compactSignalForClaudeCheck),
          situations: smartSituations.slice(0, 8).map(compactSituationForClaudeCheck),
          tasks: visibleSuggestionTasks.slice(0, 8).map(compactTaskForClaudeCheck),
        };
        const response = await fetch(`${askApiBase || ""}/api/check-relevance`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(ingestToken ? { "X-Sentinel-Ingest-Token": ingestToken } : {})
          },
          body: JSON.stringify(requestBody)
        });
        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          throw new Error(`LifeOps server returned ${response.status}${errorText ? `: ${shortServerWarning(errorText)}` : ""}`);
        }
        const data = await response.json();
        audit = data.audit || localAudit;
        serverWarning = shortServerWarning(data.warning);
      }

      setRelevanceAudit(audit);
      setSelectedAuditIds(Object.fromEntries(audit.items.filter(item => item.confidence === "high").map(item => [item.id, true])));
      setActiveTab("tasks");
      const engineLabel = auditEngineLabel(audit.engine);
      const fallbackNote = audit.engine === "local-heuristic" && canUseLifeOpsServer
        ? serverWarning
          ? ` local rules handled this because the model route returned: ${serverWarning}`
          : " local rules handled this because the model route did not return cleanup items."
        : ` Reviewed by ${engineLabel}.`;
      setNotice({
        text: audit.items.length > 0
          ? `${audit.summary} Select what you want cleared as not tasks.${fallbackNote}`
          : `Relevance check found no obvious cleanup candidates.${fallbackNote}`,
        severity: audit.items.length > 0 ? "warning" : "info"
      });
    } catch (err) {
      console.warn("Relevance check failed; using local audit:", err);
      setRelevanceAudit(localAudit);
      setSelectedAuditIds(Object.fromEntries(localAudit.items.filter(item => item.confidence === "high").map(item => [item.id, true])));
      const errorMessage = err instanceof Error ? err.message : String(err || "");
      const failureNote = /^LifeOps server returned/.test(errorMessage)
        ? ` AI check did not run: ${errorMessage}. Local rules handled this run.`
        : " LifeOps server was not reachable from the app, so this used local rules. Check the API host, CORS settings, and Android network allowlist if you expected AI analysis.";
      setNotice({
        text: localAudit.items.length > 0
          ? `${localAudit.summary}${failureNote}`
          : `Local rules found no cleanup candidates.${failureNote}`,
        severity: localAudit.items.length > 0 ? "warning" : "info"
      });
    } finally {
      setIsCheckingRelevance(false);
    }
  };

  const toggleAuditSelection = (id: string) => {
    setSelectedAuditIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const clearSelectedAuditItems = () => {
    const selectedItems = (relevanceAudit?.items || []).filter(item => selectedAuditIds[item.id]);
    if (selectedItems.length === 0) {
      setNotice({ text: "Choose at least one item to clear.", severity: "warning" });
      return;
    }

    const signalIds = new Set<string>();
    const taskIds = new Set<string>();
    const situationIds = new Set<string>();
    const feedbackUpdates: DecisionFeedbackMap = {};

    for (const item of selectedItems) {
      if (item.targetKind === "signal") signalIds.add(item.targetId);
      if (item.targetKind === "task") taskIds.add(item.targetId);
      if (item.targetKind === "situation") situationIds.add(item.targetId);
      if (item.associatedTaskId) taskIds.add(item.associatedTaskId);
      for (const id of item.associatedSignalIds || []) signalIds.add(id);

      const situation = smartSituations.find(candidate => candidate.id === item.targetId || candidate.fingerprint === item.fingerprint);
      const fingerprint = item.fingerprint || situation?.fingerprint;
      if (fingerprint) {
        feedbackUpdates[fingerprint] = { kind: "not_task", updatedAt: Date.now() };
      }
    }

    setSignalFeedback(prev => ({ ...prev, ...feedbackUpdates }));
    if (signalIds.size > 0) {
      setSuppressedSignalIds(prev => {
        const next = { ...prev };
        for (const id of signalIds) next[id] = true;
        return next;
      });
      setSentinelFeed(prev => prev.filter(signal => !signalIds.has(signal.id)));
    }
    if (taskIds.size > 0 || situationIds.size > 0) {
      setExtractedTasks(prev => prev.filter(task => !taskIds.has(task.id) && !situationIds.has(task.associatedAnchorId || "")));
    }

    setRelevanceAudit(prev => prev ? { ...prev, items: prev.items.filter(item => !selectedAuditIds[item.id]) } : prev);
    setSelectedAuditIds({});
    setNotice({ text: `Cleared ${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"} as not tasks.`, severity: "info" });
  };

  const updateActiveTaskTargetTime = (value: string) => {
    if (!activeTask) return;
    const targetTime = coerceTimeString(value);
    applyTaskChange(activeTask, { targetTime });
    setNotice({ text: targetTime ? `Task time set to ${formatTo12Hour(targetTime)}.` : "Task time cleared.", severity: "info" });
  };

  const updateTaskStepState = (taskId: string, stepId: string) => {
    const task = storedTasks.find(item => item.id === taskId);
    if (!task) return;
    const stepIndex = task.steps.findIndex(step => step.id === stepId);
    const steps = task.steps.map((step, index) => {
      if (step.id === stepId) return { ...step, state: "done" as const };
      if (index === stepIndex + 1 && step.state !== "done") return { ...step, state: "current" as const };
      return step;
    });
    const isCompleted = steps.length > 0 && steps.every(step => step.state === "done");
    applyTaskChange(task, {
      steps,
      isCompleted,
      status: isCompleted ? "done" : "open",
      completedAtEpochMillis: isCompleted ? Date.now() : null,
      nextPhysicalAction: steps.find(step => step.state === "current")?.title || "All listed steps are done."
    });
  };

  // Checkbox toggle from the task list: flips one step in either direction and
  // recomputes which step is "current" (first not-done).
  const toggleTaskStep = (task: StoredTask, stepId: string) => {
    const flipped = task.steps.map(step => step.id === stepId
      ? { ...step, state: step.state === "done" ? "pending" as const : "done" as const }
      : step);
    let currentAssigned = false;
    const steps = flipped.map(step => {
      if (step.state === "done") return step;
      if (!currentAssigned) {
        currentAssigned = true;
        return { ...step, state: "current" as const };
      }
      return step.state === "current" ? { ...step, state: "pending" as const } : step;
    });
    const isCompleted = steps.length > 0 && steps.every(step => step.state === "done");
    applyTaskChange(task, {
      steps,
      isCompleted,
      status: isCompleted ? "done" : "open",
      completedAtEpochMillis: isCompleted ? Date.now() : null,
      nextPhysicalAction: steps.find(step => step.state === "current")?.title || task.nextPhysicalAction
    });
  };

  const toggleTaskComplete = (task: StoredTask) => {
    if (task.status === "done") {
      applyTaskChange(task, { status: "open", isCompleted: false, completedAtEpochMillis: null });
      setNotice({ text: `Reopened: ${task.title}`, severity: "info" });
      return;
    }
    applyTaskChange(task, {
      status: "done",
      isCompleted: true,
      completedAtEpochMillis: Date.now(),
      steps: task.steps.map(step => ({ ...step, state: "done" as const }))
    });
    setNotice({ text: `Done: ${task.title}`, severity: "info" });
  };

  const dismissStoredTask = (task: StoredTask) => {
    applyTaskChange(task, { status: "dismissed", isCompleted: false });
    setNotice({ text: "Removed from the task list.", severity: "info" });
  };

  // "Focus" = make this the current task and open fullscreen Focus Mode.
  // The active task is the most recently touched open task, so bumping updatedAt is enough.
  const focusStoredTask = (task: StoredTask) => {
    applyTaskChange(task, {});
    setFocusModeOpen(true);
    setNotice({ text: `Focus: ${task.title}`, severity: "info" });
  };

  const handleMarkNextStepDone = () => {
    if (!activeTask || !nextStep) return;
    updateTaskStepState(activeTask.id, nextStep.id);
    setNotice({ text: `Marked done: ${nextStep.title}`, severity: "info" });
  };

  const handleFinishTask = () => {
    if (!activeTask) return;
    applyTaskChange(activeTask, {
      isCompleted: true,
      status: "done",
      completedAtEpochMillis: Date.now(),
      steps: activeTask.steps.map(step => ({ ...step, state: "done" as const }))
    });
    setNotice({ text: `Finished: ${activeTask.title}`, severity: "info" });
  };

  const handleRunningLate = () => {
    if (!activeTask) {
      setNotice({ text: "Pick a current task first, then I can shrink it to the shortest route.", severity: "warning" });
      return;
    }
    const unfinished = activeTask.steps.filter(step => step.state !== "done").slice(0, 3);
    applyTaskChange(activeTask, {
      estimatedDurationMinutes: Math.max(5, Math.round(activeTask.estimatedDurationMinutes * 0.7)),
      nextPhysicalAction: unfinished[0]?.title || activeTask.nextPhysicalAction,
      steps: unfinished.map((step, index) => ({
        ...step,
        title: step.title.replace(/^Fast route:\s*/i, ""),
        durationMinutes: Math.max(1, Math.round(step.durationMinutes * 0.7)),
        state: index === 0 ? "current" as const : "pending" as const
      }))
    });
    setNotice({ text: "Late mode: keeping only the next few useful steps.", severity: "warning" });
  };

  const handleReturnFromDrift = () => {
    if (!activeTask) return;
    window.navigator.vibrate?.([120, 60, 120]);
    setActiveTab("tasks");
    setNotice({ text: `Return to the current task. Next action: ${nextStep?.title || activeTask.nextPhysicalAction}`, severity: "error" });
  };

  const handleCreateTask = () => {
    if (!newTaskTitle.trim()) {
      setNotice({ text: "Name the task first.", severity: "warning" });
      return;
    }
    const parsedSteps = newStepsInput
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const match = line.match(/(.+?)\s*\((\d+)m\)/);
        return {
          id: `manual-step-${Date.now()}-${index}`,
          title: cleanSignalFragment(match ? match[1] : line, 90),
          durationMinutes: Math.max(1, Number(match ? match[2] : 5)),
          state: index === 0 ? "current" as const : "pending" as const
        };
      });
    const now = Date.now();
    const newTask = normalizeStoredTask({
      id: `manual-task-${now}`,
      title: newTaskTitle.trim(),
      estimatedDurationMinutes: Math.max(5, newTaskDuration),
      isCompleted: false,
      status: "open",
      targetTime: coerceTimeString(newTaskTargetTime),
      avoidanceTarget: "Opening unrelated apps before this is handled",
      nextPhysicalAction: newTaskNextPhysical.trim() || parsedSteps[0]?.title || "Open the source app and start the first step.",
      steps: parsedSteps.length > 0 ? parsedSteps : [
        { id: `manual-step-${now}-0`, title: "Open the source app or material", durationMinutes: 5, state: "current" },
        { id: `manual-step-${now}-1`, title: "Complete the requested action", durationMinutes: 10, state: "pending" }
      ],
      createdAtEpochMillis: now,
      updatedAtEpochMillis: now
    });
    if (!newTask) {
      setNotice({ text: "Task could not be created from that input.", severity: "warning" });
      return;
    }
    setStoredTasks(prev => mergeStoredTasks(prev, [newTask]));
    pushTaskToServer(newTask);
    setNewTaskTitle("");
    setNewTaskNextPhysical("");
    setNewTaskTargetTime("");
    setNewStepsInput("");
    setShowAddTaskModal(false);
    setActiveTab("tasks");
    setNotice({ text: `Current task created: ${newTask.title}`, severity: "info" });
  };

  const handleAddManualSignal = () => {
    if (!manualSignalContent.trim()) {
      setNotice({ text: "Paste the message, reminder, or screen text first.", severity: "warning" });
      return;
    }

    const signal = normalizeSignal({
      id: `manual-signal-${Date.now()}`,
      source: manualSignalSource,
      title: manualSignalTitle.trim() || (manualSignalSource === "sms" ? "Pasted SMS" : manualSignalSource === "calendar" ? "Pasted calendar item" : manualSignalSource === "screen_text" ? "Pasted screen text" : "Pasted phone item"),
      content: manualSignalContent.trim(),
      capturedAtEpochMillis: Date.now()
    });
    androidBridge?.addTelemetryJson(JSON.stringify(signal));
    setSentinelFeed(prev => dedupeSignals([signal, ...prev]));

    const task = buildTaskFromSignal(signal, 0);
    if (task) {
      setExtractedTasks(prev => [task, ...prev.filter(item => item.title !== task.title)].slice(0, 8));
      if (task.targetTime) {
        setTaskTargetOverrides(prev => ({ ...prev, [task.id]: task.targetTime! }));
      }
      setActiveTab("tasks");
      setNotice({ text: task.targetTime ? `Created a task suggestion for ${formatTo12Hour(task.targetTime)}.` : "Created a task suggestion from pasted text.", severity: "info" });
    } else {
      setNotice({ text: "Saved as context. It did not contain a concrete request, missed call, visible screen task, deadline, or appointment.", severity: "warning" });
    }

    setManualSignalTitle("");
    setManualSignalContent("");
  };

  // One-tap owner note from Today: always captured as user_note so personal notes are
  // labeled correctly in the telemetry archive (telemetry-positive; nothing is filtered).
  const handleAddQuickNote = () => {
    if (!quickNoteText.trim()) {
      setNotice({ text: "Write the note first.", severity: "warning" });
      return;
    }

    const signal = normalizeSignal({
      id: `manual-signal-${Date.now()}`,
      source: "user_note",
      title: "Quick note",
      content: quickNoteText.trim(),
      capturedAtEpochMillis: Date.now()
    });
    androidBridge?.addTelemetryJson(JSON.stringify(signal));
    setSentinelFeed(prev => dedupeSignals([signal, ...prev]));

    const task = buildTaskFromSignal(signal, 0);
    if (task) {
      setExtractedTasks(prev => [task, ...prev.filter(item => item.title !== task.title)].slice(0, 8));
      setNotice({ text: "Note captured. It also created a task suggestion.", severity: "info" });
    } else {
      setNotice({ text: "Note captured as context.", severity: "info" });
    }
    setQuickNoteText("");
  };

  const handleAskSentinel = async () => {
    const question = askQuestion.trim();
    if (!question) {
      setNotice({ text: "Ask a question about the loaded phone signals first.", severity: "warning" });
      return;
    }

    setIsAsking(true);
    const localAnswer = buildLocalAskAnswer(question, smartSituations, visibleSignals);
    try {
      if (!canUseLifeOpsServer) {
        setAskAnswer(localAnswer);
        setAskEngine("local-heuristic");
        return;
      }

      const response = await fetch(`${askApiBase || ""}/api/ask-lifeops`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(ingestToken ? { "X-Sentinel-Ingest-Token": ingestToken } : {})
        },
        body: JSON.stringify({
          question,
          situations: smartSituations.slice(0, 8).map(situation => ({
            title: situation.title,
            confidence: situation.confidence,
            urgency: situation.urgency,
            priorityScore: situation.priorityScore,
            why: situation.why,
            evidence: situation.evidence,
            recommendedAction: situation.recommendedAction,
          })),
          logs: visibleSignals.slice(0, 30).map(log => ({
            source: log.source,
            title: cleanSignalFragment(log.title, 120),
            content: cleanSignalFragment(log.content, 240),
            relevanceScore: log.relevanceScore,
            relevanceReason: log.relevanceReason,
          }))
        })
      });

      if (!response.ok) {
        throw new Error(`Ask endpoint returned ${response.status}`);
      }
      const data = await response.json();
      setAskAnswer(String(data.answer || localAnswer));
      setAskEngine(data.answer && data.engine ? (String(data.engine) as RelevanceAudit["engine"]) : "local-heuristic");
    } catch (err) {
      console.warn("Ask Sentinel failed; using local answer:", err);
      setAskAnswer(localAnswer);
      setAskEngine("local-heuristic");
    } finally {
      setIsAsking(false);
    }
  };

  const handleCreateDelayNote = () => {
    if (!slipWhat.trim()) {
      setNotice({ text: "Name what ran late first.", severity: "warning" });
      return;
    }
    const newSlip: SlipAutopsy = {
      id: `delay-${Date.now()}`,
      task_id: activeTask?.id || "manual",
      what_slipped: slipWhat.trim(),
      expected_duration: Math.max(1, slipExpected),
      actual_duration: Math.max(1, slipActual),
      hidden_steps: slipHiddenSteps.trim(),
      interruption_point: "",
      future_fix: slipFix.trim(),
      created_at: new Date().toISOString()
    };
    setSlipAutopsies(prev => [newSlip, ...prev]);
    setSlipWhat("");
    setSlipHiddenSteps("");
    setSlipFix("");
    setShowDelayModal(false);
    setNotice({ text: "Delay note saved. Future tasks should get a bigger buffer.", severity: "info" });
  };

  const permissionItems: PermissionItem[] = [
    {
      key: "runtime",
      label: "Phone data permissions",
      detail: "SMS, calls, contacts, calendar, and location.",
      isReady: Boolean(androidBridgeStatus?.sms && androidBridgeStatus?.callLog && androidBridgeStatus?.contacts && androidBridgeStatus?.calendar && (androidBridgeStatus?.coarseLocation || androidBridgeStatus?.fineLocation)),
      actionLabel: "Ask Android",
      onAction: () => androidBridge?.requestRuntimePermissions()
    },
    {
      key: "usage",
      label: "App usage access",
      detail: "Lets Sentinel tell when app activity may be distracting from a current task.",
      isReady: Boolean(androidBridgeStatus?.usageAccess),
      actionLabel: "Open settings",
      onAction: () => androidBridge?.openUsageAccessSettings()
    },
    {
      key: "notifications",
      label: "Notification access",
      detail: "Reads active notification text so reminders and requests can become signals.",
      isReady: Boolean(androidBridgeStatus?.notificationListener),
      actionLabel: "Open settings",
      onAction: () => androidBridge?.openNotificationAccessSettings()
    },
    {
      key: "accessibility",
      label: "Screen text access",
      detail: "Continuously samples owner-approved foreground app text while enabled. Secure/password screens may be unavailable.",
      isReady: Boolean(androidBridgeStatus?.accessibility),
      actionLabel: "Open settings",
      onAction: () => androidBridge?.openAccessibilitySettings()
    }
  ];
  const readyPermissionCount = permissionItems.filter(item => item.isReady).length;

  const renderRelevanceAuditPanel = () => {
    if (!relevanceAudit) return null;

    return (
      <section className="rounded-lg border border-amber-400/30 bg-slate-900 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-bold text-ink">Possible cleanup</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{relevanceAudit.summary}</p>
          </div>
          <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-bold text-amber-200">
            {auditEngineLabel(relevanceAudit.engine)}
          </span>
        </div>

        {relevanceAudit.items.length > 0 ? (
          <>
            <div className="mt-4 space-y-2">
              {relevanceAudit.items.map(item => (
                <label key={item.id} className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedAuditIds[item.id])}
                    onChange={() => toggleAuditSelection(item.id)}
                    className="mt-1 h-4 w-4 accent-cyan-400"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-100">{cleanSignalFragment(item.title, 120)}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-slate-400">{item.reason}</span>
                    <span className="mt-2 inline-block rounded-full bg-slate-800 px-2.5 py-1 text-xs font-bold text-slate-300">{item.confidence} confidence</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button onClick={() => setRelevanceAudit(null)} className="rounded-lg border border-slate-700 px-4 py-3 text-sm font-bold text-slate-300 hover:bg-slate-800">Keep all</button>
              <button onClick={clearSelectedAuditItems} className="rounded-lg bg-amber-400 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-amber-300">
                Clear selected as not tasks{selectedAuditCount ? ` (${selectedAuditCount})` : ""}
              </button>
            </div>
          </>
        ) : (
          <div className="mt-4">
            <EmptyState title="Nothing obvious to clear" body="The current signals and suggestions look relevant enough to keep." />
          </div>
        )}
      </section>
    );
  };

  const renderClaudeReviewPanel = () => (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-bold text-cyan-200">AI Review</p>
          <h2 className="mt-2 text-lg font-bold text-ink">Ask or clean up the same task context</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            The check button looks for irrelevant cards to clear. The question box asks about priorities, reasons, and what to ignore.
          </p>
          {canUseLifeOpsServer && serverHealth && (
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              AI route: {serverHealth.modelProvider || "unknown"}
              {serverHealth.model ? ` · ${serverHealth.model}` : ""}
              {serverHealth.modelRuntimeStatus ? ` · ${serverHealth.modelRuntimeStatus}` : ""}
              {serverHealth.claudeLastError ? ` · last error: ${clipForClaudeCheck(serverHealth.claudeLastError, 140)}` : ""}
              {serverHealth.aiAuth && !serverHealth.aiAuth.anthropicKeyPresent && !serverHealth.aiAuth.deepseekKeyPresent
                ? " · no AI credential configured"
                : ""}
              {serverHealth.aiAuth?.anthropicCredentialShape === "oauth_or_other"
                ? " · Claude OAuth credential"
                : serverHealth.aiAuth?.anthropicCredentialShape === "api_key"
                  ? " · Anthropic API key"
                  : ""}
            </p>
          )}
        </div>
        <div className="w-full md:w-64">
          <ActionButton
            icon={ShieldCheck}
            label={canUseLifeOpsServer ? "Have AI check" : "Review locally"}
            hint="Suggests cleanup once"
            tone="slate"
            disabled={isCheckingRelevance || activeFeed.length === 0}
            onClick={handleCheckRelevance}
          />
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
        <input
          value={askQuestion}
          onChange={event => setAskQuestion(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleAskSentinel();
            }
          }}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-ink outline-none focus:border-cyan-400"
          placeholder="Ask the AI route what matters, why a card exists, or what to ignore"
        />
        <button
          onClick={handleAskSentinel}
          disabled={isAsking}
          className="rounded-lg bg-cyan-400 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
        >
          {isAsking ? "Asking..." : "Ask"}
        </button>
      </div>
      {askAnswer && (
        <div className="mt-4 rounded-lg border border-cyan-400/20 bg-cyan-950/20 p-4">
          <div className="flex items-start justify-between gap-3">
            <span className="rounded-full bg-cyan-400/10 px-2.5 py-1 text-xs font-bold text-cyan-200">
              Answered by {askEngine ? auditEngineLabel(askEngine) : "local rules"}
            </span>
            <button
              onClick={() => {
                setAskAnswer("");
                setAskEngine(null);
              }}
              className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-ink"
              aria-label="Clear answer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-cyan-50">{askAnswer}</p>
        </div>
      )}
    </section>
  );

  const renderTaskCard = (task: ExecutiveTask) => {
    const situation = smartSituationByTaskId.get(task.id)
      || (task.associatedAnchorId ? smartSituationByTaskId.get(task.associatedAnchorId) : undefined);
    return (
      <SmartSuggestionCard
        key={task.id}
        task={task}
        situation={situation}
        targetTime={taskTargetOverrides[task.id] || task.targetTime || undefined}
        onApprove={() => approveTaskCandidate(task)}
        onDismiss={() => dismissTaskCard(task)}
      />
    );
  };

  const renderSignalCard = (signal: SentinelEvent) => {
    const Icon = sourceIcon(signal.source);
    const taskReady = isTaskCandidateSignal(signal);
    return (
      <article key={signal.id} className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
        <div className="flex items-start gap-3">
          <div className={`rounded-lg p-2 ${taskReady ? "bg-cyan-400/10 text-cyan-200" : "bg-slate-800 text-slate-400"}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${taskReady ? "bg-cyan-400/10 text-cyan-200" : "bg-slate-800 text-slate-400"}`}>
                {taskReady ? "Can suggest task" : signal.source === "app_usage" ? "Drift context" : "Context only"}
              </span>
              <span className="text-xs text-slate-500">{sourceLabel(signal.source)}</span>
              <span className="text-xs text-slate-500">{formatRelativeTime(signal.capturedAtEpochMillis)}</span>
            </div>
            <h3 className="mt-2 text-sm font-bold text-slate-100">{cleanSignalFragment(signal.title, 90)}</h3>
            {signal.content && <p className="mt-1 text-sm leading-relaxed text-slate-400">{cleanSignalFragment(signal.content, 160)}</p>}
            <p className="mt-3 text-xs leading-relaxed text-slate-500">{signal.relevanceReason || signalReason(signal)}</p>
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="min-h-screen bg-bg text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-surface/95 pt-[max(2rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-cyan-400/10 p-2 text-cyan-200">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-sm font-extrabold tracking-wide text-ink sm:text-base">Sentinel LifeOps</h1>
              <p className="text-xs text-slate-400">Phone signals to one next task</p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="flex items-center justify-end gap-1.5 text-sm font-bold text-slate-100">
              <Clock className="h-4 w-4 text-amber-300" />
              {formatTo12Hour(displayCurrentTime)}
            </div>
            <p className="text-xs text-slate-500">{isAndroidBridgeAvailable ? "Android bridge" : "Desktop preview"}</p>
          </div>
        </div>
      </header>

      <AnimatePresence initial={false}>
        {notice && (
          <motion.div
            key={notice.text}
            initial={reduceMotion ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.16 }}
            role="status"
            aria-live="polite"
            className={`border-b px-4 py-3 ${
              notice.severity === "error" ? "border-rose-500/30 bg-rose-950/50 text-rose-100" :
              notice.severity === "warning" ? "border-amber-500/30 bg-amber-950/40 text-amber-100" :
              "border-cyan-500/20 bg-cyan-950/30 text-cyan-100"
            }`}
          >
            <div className="mx-auto flex max-w-5xl items-start justify-between gap-3 text-sm">
              <span className="leading-relaxed">{notice.text}</span>
              <button onClick={() => setNotice(null)} className="rounded p-1 text-slate-300 hover:bg-white/10" aria-label="Dismiss message">
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="mx-auto max-w-5xl px-4 pb-32 pt-5">
        <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeTab}
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
        {activeTab === "today" && (
          <div className="space-y-4">
            {activeTask ? (
              <section className="rounded-2xl border border-emerald-400/25 bg-slate-900 p-5">
                <p className="text-sm font-bold text-emerald-200">Current task</p>
                <h2 className="mt-2 text-3xl font-bold leading-tight text-ink">{activeTask.title}</h2>
                <p className="mt-3 text-lg text-cyan-200/90">{nextStep?.title || activeTask.nextPhysicalAction}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {activeTask.targetTime && <Pill tone="warn">{formatTo12Hour(activeTask.targetTime)}</Pill>}
                  <Pill tone="neutral">{activeTask.estimatedDurationMinutes}m</Pill>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-4">
                  <ActionButton icon={Check} label="Step done" hint="Advance checklist" tone="green" onClick={handleMarkNextStepDone} disabled={!nextStep} />
                  <ActionButton icon={AlertTriangle} label="I'm stuck" hint="Simplify next actions" tone="amber" onClick={() => setShowStuckPanel(true)} />
                  <ActionButton icon={TimerReset} label="Running late" hint="Shrink the route" tone="red" onClick={handleRunningLate} />
                  <ActionButton icon={Crosshair} label="Focus" hint="Fullscreen current task" tone="cyan" onClick={() => setFocusModeOpen(true)} />
                </div>
              </section>
            ) : visibleSuggestionTasks.length > 0 ? (
              <section className="rounded-2xl border border-cyan-400/25 bg-slate-900 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-cyan-200">Top suggestion</p>
                    <h2 className="text-2xl font-bold text-ink">Start with this</h2>
                  </div>
                  <button onClick={() => setActiveTab("signals")} className="text-sm font-semibold text-primary hover:opacity-80">See all</button>
                </div>
                <div className="mt-4">{renderTaskCard(visibleSuggestionTasks[0])}</div>
              </section>
            ) : (
              <section className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
                <p className="text-xl font-bold text-ink">No task yet</p>
                <p className="mt-2 text-sm text-slate-400">Find tasks from your phone signals, or add one manually.</p>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
                  <ActionButton icon={Sparkles} label="Find tasks" hint="From phone signals" tone="green" disabled={isExtractingTasks || taskReadySignals.length === 0} onClick={() => handleExtractTasks(false)} />
                  <ActionButton icon={Plus} label="Add task" hint="Manual" tone="slate" onClick={() => setShowAddTaskModal(true)} />
                </div>
              </section>
            )}

            {driftSignal && activeTask && (
              <section className="rounded-xl border border-amber-400/30 bg-amber-950/20 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-bold text-amber-200">Possible phone drift</p>
                    <p className="mt-1 text-sm text-amber-100/80">{cleanSignalFragment(driftSignal.title, 90)}</p>
                  </div>
                  <ActionButton icon={ChevronRight} label="Return to task" hint="Back to current task" tone="amber" onClick={handleReturnFromDrift} />
                </div>
              </section>
            )}

            {!activeTask && (
              <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">
                    {(telemetryCounts.sms || 0) + (telemetryCounts.calendar || 0) + (telemetryCounts.notification || 0) + (telemetryCounts.screen_text || 0)} phone signals loaded
                  </span>
                  <button onClick={() => syncTelemetryLogs(true)} className="text-sm font-semibold text-primary hover:opacity-80">
                    {isSyncing ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </section>
            )}
          </div>
        )}

        {activeTab === "tasks" && (
          <div className="space-y-5">
            <section className="rounded-xl border border-cyan-400/25 bg-slate-900 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl">
                  <p className="text-sm font-bold text-cyan-200">Tasks</p>
                  <h2 className="mt-2 text-2xl font-bold text-ink">One list: current task, open tasks, done history</h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">
                    Messages, missed calls, calendar items, notifications, and visible app text become suggestions only when they contain a concrete next action. Accepted ones live here with checkmarks.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[360px]">
                  <ActionButton icon={RefreshCw} label={isSyncing ? "Refreshing..." : "Refresh data"} hint="Scan the last 24 hours" disabled={isSyncing} onClick={() => syncTelemetryLogs(true)} />
                  <ActionButton icon={Sparkles} label={isExtractingTasks ? "Building..." : "Build cards"} hint={`${taskReadySignals.length} task-ready items`} tone="green" disabled={isExtractingTasks || taskReadySignals.length === 0} onClick={() => handleExtractTasks(false)} />
                  <ActionButton icon={Plus} label="Add task" hint="Manual backup" tone="slate" onClick={() => setShowAddTaskModal(true)} />
                </div>
              </div>
            </section>

            {activeTask && (
              <>
                <section className="rounded-xl border border-emerald-400/25 bg-slate-900 p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-sm font-bold text-emerald-200">Current Task</p>
                      <h2 className="mt-2 text-2xl font-bold text-ink">{activeTask.title}</h2>
                      {activeTask.why && <p className="mt-2 text-sm leading-relaxed text-slate-400">{activeTask.why}</p>}
                      <p className="mt-3 text-base leading-relaxed text-slate-300">{nextStep?.title || activeTask.nextPhysicalAction}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 lg:w-72">
                      <StatTile label="Estimated" value={`${activeTask.estimatedDurationMinutes}m`} />
                      <StatTile label="Done" value={`${activeTask.steps.filter(step => step.state === "done").length}/${activeTask.steps.length}`} />
                    </div>
                  </div>
                  <label className="mt-5 block max-w-xs">
                    <span className="text-sm font-bold text-slate-300">Target time</span>
                    <input
                      type="time"
                      value={activeTask.targetTime || ""}
                      onChange={event => updateActiveTaskTargetTime(event.target.value)}
                      className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-ink outline-none focus:border-cyan-400"
                    />
                  </label>
                  <div className="mt-5 grid gap-3 md:grid-cols-5">
                    <ActionButton icon={Check} label="Step done" hint="Advance checklist" tone="green" onClick={handleMarkNextStepDone} disabled={!nextStep} />
                    <ActionButton icon={AlertTriangle} label="I'm stuck" hint="Simplify next actions" tone="amber" onClick={() => setShowStuckPanel(true)} />
                    <ActionButton icon={TimerReset} label="Running late" hint="Shrink the route" tone="red" onClick={handleRunningLate} />
                    <ActionButton icon={Crosshair} label="Focus" hint="Fullscreen current task" tone="cyan" onClick={() => setFocusModeOpen(true)} />
                    <ActionButton icon={CheckCircle2} label="Finish task" hint="Mark all done" tone="slate" onClick={handleFinishTask} />
                  </div>
                  <div className="mt-5 space-y-3">
                    {activeTask.steps.map((step, index) => (
                      <button
                        key={step.id}
                        onClick={() => {
                          if (step.state === "done") return;
                          if (androidBridge?.openSourceApp) {
                            androidBridge.openSourceApp(step.packageName || "", step.source || undefined);
                          }
                          updateTaskStepState(activeTask.id, step.id);
                        }}
                        className={`flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                          step.state === "done" ? "border-emerald-700 bg-emerald-950/30" :
                          step.state === "current" ? "border-cyan-400/50 bg-cyan-950/20" :
                          "border-slate-800 bg-slate-950/60 hover:border-slate-700"
                        }`}
                      >
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                          step.state === "done" ? "bg-emerald-500 text-slate-950" :
                          step.state === "current" ? "bg-cyan-400 text-slate-950" :
                          "bg-slate-800 text-slate-300"
                        }`}>
                          {step.state === "done" ? <Check className="h-4 w-4" /> : index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-bold text-ink">{step.title}</span>
                          <span className="mt-1 block text-xs text-slate-500">{step.durationMinutes} minutes</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                {(activeTask.targetTime || driftSignal) && (
                  <section className="grid gap-4 lg:grid-cols-2">
                    {activeTask.targetTime && (
                      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                        <h3 className="text-lg font-bold text-ink">Time plan</h3>
                        <dl className="mt-4 space-y-3 text-sm">
                          <div className="flex justify-between gap-4"><dt className="text-slate-500">Prep starts</dt><dd className="font-bold text-ink">{prepStartLabel}</dd></div>
                          <div className="flex justify-between gap-4"><dt className="text-slate-500">Leave by</dt><dd className="font-bold text-ink">{hardLeaveLabel}</dd></div>
                          <div className="flex justify-between gap-4"><dt className="text-slate-500">Target</dt><dd className="font-bold text-ink">{formatTo12Hour(activeTask.targetTime)}</dd></div>
                        </dl>
                      </div>
                    )}
                    {driftSignal && (
                      <div className="rounded-xl border border-amber-400/30 bg-amber-950/20 p-5">
                        <h3 className="text-lg font-bold text-ink">Possible phone drift</h3>
                        <p className="mt-2 text-sm leading-relaxed text-amber-100/80">{cleanSignalFragment(driftSignal.title, 100)}</p>
                        <button onClick={handleReturnFromDrift} className="mt-4 rounded-lg bg-amber-400 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-amber-300">Return to next action</button>
                      </div>
                    )}
                  </section>
                )}

                <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-ink">Delay notes</h3>
                      <p className="mt-1 text-sm text-slate-400">Use this only when a task ran late and you want future estimates to account for the hidden steps.</p>
                    </div>
                    <button onClick={() => setShowDelayModal(true)} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-bold text-ink hover:bg-slate-700">
                      Log a delay
                    </button>
                  </div>
                  {slipAutopsies.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {slipAutopsies.slice(0, 3).map(note => (
                        <div key={note.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm">
                          <p className="font-bold text-ink">{note.what_slipped}</p>
                          <p className="mt-1 text-slate-500">Expected {note.expected_duration}m, actual {note.actual_duration}m</p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}

            <TaskList
              tasks={storedTasks}
              isLoading={isExtractingTasks && storedTasks.length === 0}
              fallbackWhyFor={task => smartSituationByTaskId.get(task.situationId || task.associatedAnchorId || task.id)?.why[0]}
              onToggleComplete={toggleTaskComplete}
              onToggleStep={toggleTaskStep}
              onDismiss={dismissStoredTask}
              onFocus={focusStoredTask}
            />

            {renderClaudeReviewPanel()}
            {renderRelevanceAuditPanel()}


          </div>
        )}

        {activeTab === "signals" && (
          <div className="space-y-5">
            <section className="rounded-xl border border-cyan-400/25 bg-slate-900 p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-sm font-bold text-cyan-200">Suggestions</p>
                  <h2 className="mt-2 text-2xl font-bold text-ink">Tasks your phone is hinting at</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">Tap the checkmark to add a task. Tap the X to dismiss it.</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <ActionButton icon={RefreshCw} label={isSyncing ? "Refreshing..." : "Refresh"} hint="Scan the phone" disabled={isSyncing} onClick={() => syncTelemetryLogs(true)} />
                  <ActionButton icon={Sparkles} label={isExtractingTasks ? "Finding..." : "Find tasks"} hint={`${taskReadySignals.length} task-ready items`} tone="green" disabled={isExtractingTasks || taskReadySignals.length === 0} onClick={() => handleExtractTasks(false)} />
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {isExtractingTasks && (
                  <div className="space-y-3" aria-hidden>
                    {[0, 1].map(row => (
                      <div key={row} className="animate-pulse rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                        <div className="h-3 w-28 rounded bg-slate-800" />
                        <div className="mt-3 h-4 w-2/3 rounded bg-slate-800" />
                        <div className="mt-2 h-3 w-1/2 rounded bg-slate-800/70" />
                      </div>
                    ))}
                  </div>
                )}
                {!isExtractingTasks && (visibleSuggestionTasks.length > 0 ? visibleSuggestionTasks.map(renderTaskCard) : (
                  <EmptyState
                    title="No suggestions yet"
                    body={taskReadySignals.length > 0 ? "Phone signals are loaded. Tap Find tasks to turn them into suggestions." : "Refresh to look for messages, missed calls, calendar events, notifications, and screen text with a real action."}
                  />
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="text-lg font-bold text-ink">Paste a phone item</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">Useful in desktop preview, or when Android did not expose a specific message yet.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-[160px_1fr]">
                <label className="block">
                  <span className="text-sm font-bold text-slate-300">Source</span>
                  <select
                    value={manualSignalSource}
                    onChange={event => setManualSignalSource(event.target.value as SentinelEvent["source"])}
                    className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-ink outline-none focus:border-cyan-400"
                  >
                    <option value="sms">SMS</option>
                    <option value="notification">Notification</option>
                    <option value="calendar">Calendar</option>
                    <option value="screen_text">Screen text</option>
                    <option value="user_note">Note</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-slate-300">Title</span>
                  <input
                    value={manualSignalTitle}
                    onChange={event => setManualSignalTitle(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-ink outline-none focus:border-cyan-400"
                    placeholder="Who or what is this from?"
                  />
                </label>
              </div>
              <label className="mt-3 block">
                <span className="text-sm font-bold text-slate-300">Text</span>
                <textarea
                  value={manualSignalContent}
                  onChange={event => setManualSignalContent(event.target.value)}
                  rows={4}
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-ink outline-none focus:border-cyan-400"
                  placeholder="Paste the real message, reminder, event, or screen text here."
                />
              </label>
              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleAddManualSignal}
                  className="rounded-lg bg-cyan-400 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-300"
                >
                  Save and suggest
                </button>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-bold text-ink">Recent phone signals</h2>
              {visibleSignals.length > 0 ? visibleSignals.map(renderSignalCard) : (
                <EmptyState
                  title="No useful phone signals visible"
                  body="Open Access if the app is not receiving notifications, screen text, SMS, call log, calendar, or usage data."
                />
              )}
            </section>
          </div>
        )}

        {activeTab === "access" && (
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-sm font-bold text-cyan-200">Setup</p>
                  <h2 className="mt-2 text-2xl font-bold text-ink">{readyPermissionCount}/4 access groups ready</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">These buttons open Android settings. After granting access, come back here and tap Refresh status.</p>
                </div>
                <ActionButton icon={RefreshCw} label="Refresh status" hint="Recheck Android grants" onClick={refreshAndroidStatus} />
              </div>
            </section>

            <section className="grid gap-3 md:grid-cols-2">
              {permissionItems.map(item => (
                <article key={item.key} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold text-ink">{item.label}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.detail}</p>
                    </div>
                    <Pill tone={item.isReady ? "success" : "warn"}>{item.isReady ? "Ready" : "Needs setup"}</Pill>
                  </div>
                  <button
                    onClick={item.onAction}
                    disabled={!isAndroidBridgeAvailable}
                    className="mt-5 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-left text-sm font-bold text-ink hover:bg-slate-700 disabled:opacity-45"
                  >
                    {isAndroidBridgeAvailable ? item.actionLabel : "Available on Android"}
                  </button>
                </article>
              ))}
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-lg font-bold text-ink">Server &amp; AI health</h3>
                  <p className="mt-2 text-sm text-slate-400">
                    {canUseLifeOpsServer
                      ? "Live status from the Render/API host used for AI and telemetry ingest."
                      : "No server URL configured in this build. AI falls back to local rules."}
                  </p>
                </div>
                <ActionButton
                  icon={RefreshCw}
                  label="Refresh health"
                  hint="Re-check /api/health"
                  tone="slate"
                  disabled={!canUseLifeOpsServer}
                  onClick={() => {
                    if (!canUseLifeOpsServer) return;
                    fetch(`${askApiBase || ""}/api/health`)
                      .then(response => (response.ok ? response.json() : null))
                      .then(data => {
                        if (data && typeof data === "object") {
                          setServerHealth(data);
                          setNotice({ text: `Server health: ${data.modelRuntimeStatus || data.modelProvider || "ok"}`, severity: "info" });
                        }
                      })
                      .catch(() => {
                        setServerHealth({
                          modelProvider: "unreachable",
                          modelRuntimeStatus: `no response from ${askApiBase || "the local server"}`,
                        });
                        setNotice({ text: "Server health check failed.", severity: "error" });
                      });
                  }}
                />
              </div>
              {serverHealth ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
                    <p className="text-slate-500">Provider</p>
                    <p className="font-bold text-ink">{serverHealth.modelProvider || "unknown"}</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
                    <p className="text-slate-500">Runtime</p>
                    <p className="font-bold text-ink">{serverHealth.modelRuntimeStatus || "unknown"}</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
                    <p className="text-slate-500">Model</p>
                    <p className="font-bold text-ink">{serverHealth.model || "—"}</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
                    <p className="text-slate-500">Mode</p>
                    <p className="font-bold text-ink">{serverHealth.mode || "—"}</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
                    <p className="text-slate-500">AI credential</p>
                    <p className="font-bold text-ink">
                      {serverHealth.aiAuth?.anthropicCredentialShape === "api_key"
                        ? "Anthropic API key"
                        : serverHealth.aiAuth?.anthropicCredentialShape === "oauth_or_other"
                          ? "Claude OAuth"
                          : serverHealth.aiAuth?.anthropicKeyPresent
                            ? "Present"
                            : serverHealth.aiAuth?.deepseekKeyPresent
                              ? "DeepSeek only"
                              : "Missing"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
                    <p className="text-slate-500">Last AI success</p>
                    <p className="font-bold text-ink">
                      {serverHealth.claudeLastSuccessAt
                        ? formatRelativeTime(Date.parse(serverHealth.claudeLastSuccessAt) || undefined)
                        : "Never this boot"}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-500">Health not loaded yet.</p>
              )}
              {serverHealth?.claudeLastError && (
                <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-950/20 p-3 text-sm text-rose-100">
                  Last AI error: {clipForClaudeCheck(serverHealth.claudeLastError, 240)}
                </p>
              )}
              {serverHealth?.aiAuth?.anthropicCredentialShape === "oauth_or_other" && (
                <p className="mt-3 rounded-lg border border-cyan-400/20 bg-cyan-950/20 p-3 text-sm text-cyan-100">
                  Using a Claude OAuth credential (expected for agent-sdk). If you switched Claude accounts, update the OAuth token/env on Render and redeploy.
                </p>
              )}
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h3 className="text-lg font-bold text-ink">Bridge status</h3>
              <p className="mt-2 text-sm text-slate-400">{isAndroidBridgeAvailable ? "The installed APK is connected to the native Android bridge." : "This browser preview cannot read phone data directly. Install/open the Android app for live capture."}</p>
              {androidBridgeStatus && (
                <>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {([
                      { key: "sms", label: "SMS" },
                      { key: "callLog", label: "Call log" },
                      { key: "contacts", label: "Contacts" },
                      { key: "calendar", label: "Calendar" },
                      { key: "coarseLocation", label: "Location (coarse)" },
                      { key: "fineLocation", label: "Location (fine)" },
                      { key: "usageAccess", label: "App usage access" },
                      { key: "notificationListener", label: "Notification access" },
                      { key: "accessibility", label: "Screen text access" }
                    ] as const)
                      .filter(flag => flag.key in (androidBridgeStatus as Record<string, unknown>))
                      .map(flag => {
                        const granted = Boolean((androidBridgeStatus as Record<string, unknown>)[flag.key]);
                        return (
                          <div key={flag.key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
                            <span className="text-slate-300">{flag.label}</span>
                            <Pill tone={granted ? "success" : "warn"}>{granted ? "Granted" : "Off"}</Pill>
                          </div>
                        );
                      })}
                  </div>
                  <button
                    onClick={() => setShowBridgeDiagnostics(prev => !prev)}
                    className="mt-3 text-xs font-semibold text-cyan-300 hover:text-cyan-200"
                  >
                    {showBridgeDiagnostics ? "Hide diagnostics" : "Show diagnostics"}
                  </button>
                  {showBridgeDiagnostics && (
                    <pre className="mt-3 max-h-64 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs leading-relaxed text-slate-300">
                      {JSON.stringify(androidBridgeStatus, null, 2)}
                    </pre>
                  )}
                </>
              )}
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <ActionButton icon={Settings} label="Open app settings" hint="Android app permissions page" tone="slate" disabled={!isAndroidBridgeAvailable} onClick={() => androidBridge?.openAppSettings()} />
                <ActionButton icon={RefreshCw} label={isSyncing ? "Refreshing..." : "Refresh phone data"} hint="Pull a fresh telemetry snapshot" disabled={!isAndroidBridgeAvailable || isSyncing} onClick={() => syncTelemetryLogs(true)} />
              </div>
            </section>

          </div>
        )}
        </motion.div>
        </AnimatePresence>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-surface/95 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto grid max-w-5xl grid-cols-4 gap-1 sm:gap-2">
          {([
            { key: "today", label: "Now", icon: Clock },
            { key: "signals", label: "Inbox", icon: Inbox },
            { key: "tasks", label: "Tasks", icon: ListChecks },
            { key: "access", label: "Setup", icon: Settings }
          ] as const).map(item => {
            const Icon = item.icon;
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                className={`flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold transition-colors ${
                  active ? "bg-primary text-primary-ink" : "text-ink-muted hover:bg-surface-alt hover:text-ink"
                }`}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>

      {showStuckPanel && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70 p-4 sm:items-center sm:justify-center">
          <div className="w-full max-w-lg rounded-xl border border-amber-400/30 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-ink">Only these actions matter now</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">Ignore everything else until one of these is done.</p>
              </div>
              <button onClick={() => setShowStuckPanel(false)} className="rounded p-2 text-slate-400 hover:bg-slate-800 hover:text-ink" aria-label="Close stuck panel">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 space-y-3">
              {(activeTask?.steps.filter(step => step.state !== "done").slice(0, 3) || []).map((step, index) => (
                <button
                  key={step.id}
                  onClick={() => {
                    updateTaskStepState(activeTask!.id, step.id);
                    setShowStuckPanel(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg border border-slate-700 bg-slate-950 p-4 text-left hover:border-cyan-400/50"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-slate-950">{index + 1}</span>
                  <span className="text-sm font-bold text-ink">{step.title}</span>
                </button>
              ))}
              {!activeTask && (
                <EmptyState title="No task selected" body="Go to Suggestions and start one task card." />
              )}
            </div>
          </div>
        </div>
      )}

      {showAddTaskModal && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70 p-4 sm:items-center sm:justify-center">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-ink">Add a current task</h2>
                <p className="mt-2 text-sm text-slate-400">Backup path for something Android did not capture.</p>
              </div>
              <button onClick={() => setShowAddTaskModal(false)} className="rounded p-2 text-slate-400 hover:bg-slate-800 hover:text-ink" aria-label="Close add task">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-sm font-bold text-slate-300">Task name</span>
                <input value={newTaskTitle} onChange={event => setNewTaskTitle(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-ink outline-none focus:border-cyan-400" placeholder="What needs to happen?" />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-slate-300">First physical action</span>
                <input value={newTaskNextPhysical} onChange={event => setNewTaskNextPhysical(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-ink outline-none focus:border-cyan-400" placeholder="The first thing your body does" />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-slate-300">Estimated minutes</span>
                <input type="number" min={5} value={newTaskDuration} onChange={event => setNewTaskDuration(Number(event.target.value) || 15)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-ink outline-none focus:border-cyan-400" />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-slate-300">Target time</span>
                <input type="time" value={newTaskTargetTime} onChange={event => setNewTaskTargetTime(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-ink outline-none focus:border-cyan-400" />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-slate-300">Steps</span>
                <textarea value={newStepsInput} onChange={event => setNewStepsInput(event.target.value)} rows={4} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-ink outline-none focus:border-cyan-400" placeholder="One step per line. Optional: add minutes like (10m)." />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setShowAddTaskModal(false)} className="rounded-lg px-4 py-3 text-sm font-bold text-slate-300 hover:bg-slate-800">Cancel</button>
              <button onClick={handleCreateTask} className="rounded-lg bg-cyan-400 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-300">Make current task</button>
            </div>
          </div>
        </div>
      )}

      {showDelayModal && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70 p-4 sm:items-center sm:justify-center">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-ink">Log a delay</h2>
                <p className="mt-2 text-sm text-slate-400">This helps future task estimates stop being too small.</p>
              </div>
              <button onClick={() => setShowDelayModal(false)} className="rounded p-2 text-slate-400 hover:bg-slate-800 hover:text-ink" aria-label="Close delay note">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-sm font-bold text-slate-300">What ran late?</span>
                <input value={slipWhat} onChange={event => setSlipWhat(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-ink outline-none focus:border-cyan-400" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-bold text-slate-300">Expected</span>
                  <input type="number" min={1} value={slipExpected} onChange={event => setSlipExpected(Number(event.target.value) || 1)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-ink outline-none focus:border-cyan-400" />
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-slate-300">Actual</span>
                  <input type="number" min={1} value={slipActual} onChange={event => setSlipActual(Number(event.target.value) || 1)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-ink outline-none focus:border-cyan-400" />
                </label>
              </div>
              <label className="block">
                <span className="text-sm font-bold text-slate-300">Hidden steps</span>
                <textarea value={slipHiddenSteps} onChange={event => setSlipHiddenSteps(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-ink outline-none focus:border-cyan-400" />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-slate-300">Fix for next time</span>
                <input value={slipFix} onChange={event => setSlipFix(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-ink outline-none focus:border-cyan-400" />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setShowDelayModal(false)} className="rounded-lg px-4 py-3 text-sm font-bold text-slate-300 hover:bg-slate-800">Cancel</button>
              <button onClick={handleCreateDelayNote} className="rounded-lg bg-cyan-400 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-300">Save delay note</button>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {focusModeOpen && activeTask && (
          <FocusMode
            key="focus"
            task={activeTask}
            nextStep={nextStep}
            driftSignal={driftSignal}
            onClose={() => setFocusModeOpen(false)}
            onStepDone={handleMarkNextStepDone}
            onStuck={() => setShowStuckPanel(true)}
            onRunningLate={handleRunningLate}
            onFinish={handleFinishTask}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
