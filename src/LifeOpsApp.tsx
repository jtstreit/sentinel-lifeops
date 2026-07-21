import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BrainCircuit,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Crosshair,
  CloudUpload,
  FolderOpen,
  Inbox,
  ListChecks,
  MessageSquare,
  RefreshCw,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TimerReset,
  X,
  Zap
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ExecutiveTask, SentinelEvent, SlipAutopsy, StoredTask } from "./types";
import { formatTo12Hour, generateReverseTimeline, minutesToTimeString } from "./cartographer";
import { Pill } from "./components/ui";
import { FocusMode } from "./components/FocusMode";
import { SmartSuggestionCard } from "./components/SmartSuggestionCard";
import { TaskList } from "./components/TaskList";
import { buildAppliedCoachChanges, type TaskCoachPlan } from "./appliedCoachPlan";
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
  normalizeHumanTaskTitle,
  normalizeTask,
  signalReason,
  taskSignals,
} from "./lifeopsRules";

type SentinelAndroidBridge = {
  getBridgeStatusJson: () => string;
  getTelemetryJson: () => string;
  refreshTelemetryJson?: () => string;
  exportTelemetrySnapshotJson?: (baseUrl: string, token: string, forceRefresh: boolean) => string;
  getSparkDriveStatusJson?: () => string;
  chooseSparkDriveFolder?: () => void;
  exportSparkDriveNowJson?: () => string;
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
type AiProvenance = { engine: string; model: string | null; mode: string };
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
    cyan: "bg-[#25b8c4] text-[#041619] hover:brightness-105 border-transparent",
    ai: "bg-accent text-[#0a1030] hover:brightness-105 border-transparent",
    green: "bg-[#4ade80] text-[#06150b] hover:brightness-105 border-transparent",
    amber: "bg-[#f6c64f] text-[#211500] hover:brightness-105 border-transparent",
    slate: "bg-white/[0.07] text-ink hover:bg-white/[0.1] border-white/[0.08]",
    red: "bg-[#f16065] text-white hover:brightness-105 border-transparent"
  };
  return `${map[tone]} border rounded-2xl px-4 py-3.5 text-left font-semibold shadow-soft transition-all active:scale-[0.99] disabled:opacity-45 disabled:cursor-not-allowed`;
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
    <button onClick={onClick} disabled={disabled} className={`${primaryButtonClass(tone)} flex min-h-[58px] w-full items-center gap-3`}>
      <Icon className="h-[19px] w-[19px] shrink-0" strokeWidth={2.2} />
      <span className="min-w-0">
        <span className="block text-[16px] leading-tight">{label}</span>
        {hint && <span className="mt-0.5 block text-xs font-medium leading-snug opacity-75">{hint}</span>}
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
  if (engine === "claude-agent-sdk") return "Claude agent";
  if (engine === "claude-sdk") return "Claude API";
  if (engine === "claude-code-cli") return "Claude Code";
  if (engine === "deepseek") return "DeepSeek";
  return "local rules";
}

function aiProvenanceLabel(provenance: AiProvenance | null | undefined) {
  if (!provenance) return "local rules";
  if (provenance.model) return provenance.model;
  return auditEngineLabel(provenance.engine as RelevanceAudit["engine"]);
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
  const [relevanceProvenance, setRelevanceProvenance] = useState<AiProvenance | null>(null);
  const [selectedAuditIds, setSelectedAuditIds] = useState<Record<string, boolean>>({});
  const [isExtractingTasks, setIsExtractingTasks] = useState(false);
  const [isCheckingRelevance, setIsCheckingRelevance] = useState(false);
  const [askQuestion, setAskQuestion] = useState("");
  const [askAnswer, setAskAnswer] = useState("");
  const [askProvenance, setAskProvenance] = useState<AiProvenance | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [coachTask, setCoachTask] = useState<StoredTask | null>(null);
  const [coachPlan, setCoachPlan] = useState<TaskCoachPlan | null>(null);
  const [isCoaching, setIsCoaching] = useState(false);
  const [aiReviewEnabled, setAiReviewEnabled] = useState(true);
  const [serverHealth, setServerHealth] = useState<{
    modelProvider?: string;
    modelRuntimeStatus?: string;
    model?: string | null;
    fastModel?: string | null;
    deepModel?: string | null;
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
  const [sparkDriveStatus, setSparkDriveStatus] = useState<Record<string, any> | null>(null);
  const [isExportingSparkDrive, setIsExportingSparkDrive] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
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
  const [taskTargetOverrides, setTaskTargetOverrides] = useState<Record<string, string>>({});
  const [slipWhat, setSlipWhat] = useState("");
  const [slipExpected, setSlipExpected] = useState(15);
  const [slipActual, setSlipActual] = useState(30);
  const [slipHiddenSteps, setSlipHiddenSteps] = useState("");
  const [slipFix, setSlipFix] = useState("");
  const lastAutoExtractKeyRef = useRef("");
  const lastTimelineNoticeKeyRef = useRef("");
  const coachingRequestRef = useRef(false);
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
  const lastSignalTime = activeFeed[0]?.capturedAtEpochMillis;
  const selectedAuditCount = relevanceAudit?.items.filter(item => selectedAuditIds[item.id]).length || 0;

  const timeline = useMemo(() => {
    if (!activeTask?.targetTime) return { reverseSteps: [], hardLeaveMinutes: null as number | null, prepStartMinutes: null as number | null };
    return generateReverseTimeline(activeTask.targetTime, activeTask.steps, 20, 15);
  }, [activeTask]);


  const refreshAndroidStatus = useCallback(() => {
    if (!androidBridge) return;
    setAndroidBridgeStatus(parseBridgeJson(androidBridge.getBridgeStatusJson(), null));
    if (androidBridge.getSparkDriveStatusJson) {
      setSparkDriveStatus(parseBridgeJson(androidBridge.getSparkDriveStatusJson(), null));
    }
  }, [androidBridge]);

  const exportSparkDriveNow = useCallback(() => {
    if (!androidBridge?.exportSparkDriveNowJson) return;
    setIsExportingSparkDrive(true);
    window.setTimeout(() => {
      const result = parseBridgeJson<Record<string, any>>(androidBridge.exportSparkDriveNowJson?.(), {});
      setIsExportingSparkDrive(false);
      refreshAndroidStatus();
      setNotice(result.success
        ? { text: `Spark coaching feed updated with ${result.eventCount || 0} phone signals.`, severity: "info" }
        : { text: result.error || "Spark coaching export failed.", severity: "error" });
    }, 50);
  }, [androidBridge, refreshAndroidStatus]);

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
          const synced = /exported\s+\d+/i.test(exportLabel);
          // Periodic sync messages must never clobber an unacknowledged error.
          setNotice(prev => (!forceRefresh && prev?.severity === "error") ? prev : {
            text: `${forceRefresh ? "Refreshed" : "Added"} ${newCount || incoming.length} signals · ${actionable} task-ready${synced ? " · synced" : ""}`,
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

  // Keep the header's live model/server indicator honest on every screen.
  useEffect(() => {
    if (!canUseLifeOpsServer) return;
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
  }, [askApiBase, canUseLifeOpsServer]);

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
    const handleSparkDriveUpdate = (event: Event) => {
      refreshAndroidStatus();
      const customEvent = event as CustomEvent<string>;
      const result = parseBridgeJson<Record<string, any>>(customEvent.detail, {});
      setNotice(result.success
        ? { text: `Spark coaching folder connected and updated with ${result.eventCount || 0} signals.`, severity: "info" }
        : { text: result.error || "Spark coaching folder connected; the first export is still pending.", severity: "warning" });
    };
    window.addEventListener("lifeops-spark-drive-updated", handleSparkDriveUpdate);
    return () => window.removeEventListener("lifeops-spark-drive-updated", handleSparkDriveUpdate);
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
      let extractionProvenance: AiProvenance | null = null;
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
              mode: "fast",
              situations: smartSituations.slice(0, 8).map(compactSituationForTaskExtraction),
              logs: taskReadySignals.slice(0, 30).map(compactSignalForClaudeCheck)
            })
          });
          if (response.ok) {
            const data = await response.json();
            parsedTasks = (data.results || []).map(normalizeTask).filter(Boolean) as ExecutiveTask[];
            extractionProvenance = {
              engine: String(data.engine || "local-heuristic"),
              model: typeof data.model === "string" && data.model ? data.model : null,
              mode: String(data.mode || "fast"),
            };
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
      const aiWorded = parsedTasks.length > 0 && extractionProvenance?.engine !== "local-heuristic";
      const resultSource = aiWorded
        ? `worded by ${aiProvenanceLabel(extractionProvenance)} in ${extractionProvenance?.mode || "fast"} mode from grouped phone evidence`
        : "from actionable phone signals";
      setNotice({
        text: nextTasks.length > 0
          ? `Built ${nextTasks.length} task suggestion${nextTasks.length === 1 ? "" : "s"} ${resultSource}.`
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
    if (isCheckingRelevance || isCoaching) return;
    setIsCheckingRelevance(true);
    setNotice({
      text: canUseLifeOpsServer ? "Asking the AI route to review the loaded signals once..." : "Reviewing locally. No LifeOps server is configured for this build.",
      severity: "info"
    });
    const localAudit = buildLocalRelevanceAudit(activeFeed, smartSituations);
    try {
      let audit = localAudit;
      let serverWarning = "";
      let provenance: AiProvenance | null = null;
      if (canUseLifeOpsServer) {
        const requestBody = {
          mode: "deep",
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
        provenance = {
          engine: String(data.audit?.engine || data.engine || "local-heuristic"),
          model: typeof data.model === "string" && data.model ? data.model : null,
          mode: String(data.mode || "deep"),
        };
      }

      setRelevanceAudit(audit);
      setRelevanceProvenance(provenance);
      setSelectedAuditIds(Object.fromEntries(audit.items.filter(item => item.confidence === "high").map(item => [item.id, true])));
      setActiveTab("tasks");
      const engineLabel = provenance ? aiProvenanceLabel(provenance) : auditEngineLabel(audit.engine);
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
      setRelevanceProvenance(null);
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
      setActiveTab("signals");
      setNotice({ text: task.targetTime ? `Created a task suggestion for ${formatTo12Hour(task.targetTime)}.` : "Created a task suggestion from pasted text.", severity: "info" });
    } else {
      setNotice({ text: "Saved as context. It did not contain a concrete request, missed call, visible screen task, deadline, or appointment.", severity: "warning" });
    }

    setManualSignalTitle("");
    setManualSignalContent("");
  };

  const handleAskSentinel = async () => {
    if (isAsking || isCoaching) return;
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
        setAskProvenance({ engine: "local-heuristic", model: null, mode: "local" });
        return;
      }

      const response = await fetch(`${askApiBase || ""}/api/ask-lifeops`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(ingestToken ? { "X-Sentinel-Ingest-Token": ingestToken } : {})
        },
        body: JSON.stringify({
          mode: "deep",
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
      setAskProvenance({
        engine: String(data.answer && data.engine ? data.engine : "local-heuristic"),
        model: typeof data.model === "string" && data.model ? data.model : null,
        mode: String(data.mode || (data.answer ? "deep" : "local")),
      });
    } catch (err) {
      console.warn("Ask Sentinel failed; using local answer:", err);
      setAskAnswer(localAnswer);
      setAskProvenance({ engine: "local-heuristic", model: null, mode: "local" });
    } finally {
      setIsAsking(false);
    }
  };

  const handleAskOpus = async (task: StoredTask) => {
    if (coachingRequestRef.current || isCoaching) return;
    coachingRequestRef.current = true;
    setCoachTask(task);
    setCoachPlan(null);
    setIsCoaching(true);

    const situation = smartSituationByTaskId.get(task.situationId || task.associatedAnchorId || task.id);
    const relevantSignalIds = new Set(task.sourceLogIds || situation?.signals.map(signal => signal.id) || []);
    const context = activeFeed
      .filter(signal => relevantSignalIds.has(signal.id))
      .slice(0, 6)
      .map(compactSignalForClaudeCheck);

    try {
      if (!canUseLifeOpsServer) {
        throw new Error("The LifeOps AI server is not configured in this build.");
      }
      const response = await fetch(`${askApiBase || ""}/api/coach-task`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(ingestToken ? { "X-Sentinel-Ingest-Token": ingestToken } : {})
        },
        body: JSON.stringify({
          task: compactTaskForClaudeCheck(task),
          context,
          mode: "deep"
        })
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Opus planning returned ${response.status}${detail ? `: ${shortServerWarning(detail)}` : ""}`);
      }
      const data = await response.json();
      if (!data?.plan || !Array.isArray(data.plan.chunks)) {
        throw new Error("Opus did not return a usable task plan.");
      }
      setCoachPlan({ ...data.plan, engine: data.engine, model: data.model, mode: data.mode });
    } catch (err) {
      console.warn("Opus task planning failed:", err);
      setCoachTask(null);
      setNotice({ text: err instanceof Error ? err.message : "Opus could not build a plan for this task.", severity: "error" });
    } finally {
      coachingRequestRef.current = false;
      setIsCoaching(false);
    }
  };

  const handleApplyCoachPlan = () => {
    if (!coachTask || !coachPlan) return;
    const now = Date.now();
    applyTaskChange(coachTask, buildAppliedCoachChanges(coachPlan, now));
    setCoachTask(null);
    setCoachPlan(null);
    setActiveTab("today");
    setNotice({ text: "Opus plan applied. The first small step is ready.", severity: "info" });
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
      <section className="rounded-2xl border border-amber-400/25 bg-amber-300/[0.05] p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">Possible cleanup</h2>
            <p className="mt-1.5 text-xs leading-5 text-ink-muted">{relevanceAudit.summary}</p>
          </div>
          <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-bold text-amber-200">
            {relevanceProvenance ? `${aiProvenanceLabel(relevanceProvenance)} · ${relevanceProvenance.mode}` : auditEngineLabel(relevanceAudit.engine)}
          </span>
        </div>

        {relevanceAudit.items.length > 0 ? (
          <>
            <div className="mt-4 space-y-2">
              {relevanceAudit.items.map(item => (
                <label key={item.id} className="flex items-start gap-3 rounded-2xl border border-white/[0.07] bg-black/20 p-3">
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
              <button onClick={() => setRelevanceAudit(null)} className="rounded-xl border border-white/[0.08] px-4 py-3 text-sm font-medium text-ink-muted">Keep all</button>
              <button onClick={clearSelectedAuditItems} className="rounded-xl bg-amber-300 px-4 py-3 text-sm font-semibold text-amber-950">
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
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BrainCircuit className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-ink">AI Review</h3>
        </div>
        <button
          type="button"
          onClick={() => setAiReviewEnabled(enabled => !enabled)}
          className={`relative h-7 w-12 rounded-full border transition-colors ${aiReviewEnabled ? "border-primary/30 bg-primary" : "border-white/10 bg-white/[0.06]"}`}
          aria-pressed={aiReviewEnabled}
          aria-label={`${aiReviewEnabled ? "Disable" : "Enable"} AI review`}
        >
          <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${aiReviewEnabled ? "translate-x-5" : "translate-x-0"}`} />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 rounded-xl border border-white/[0.07] bg-black/20 p-1">
        <button
          type="button"
          onClick={() => handleExtractTasks(false)}
          disabled={!aiReviewEnabled || isExtractingTasks || taskReadySignals.length === 0}
          className="rounded-lg bg-white/[0.09] px-2 py-2 text-xs font-semibold text-ink disabled:opacity-40"
        >
          {isExtractingTasks ? "Suggesting..." : "Quick suggest"}
        </button>
        <button
          type="button"
          onClick={handleCheckRelevance}
          disabled={!aiReviewEnabled || isCheckingRelevance || isCoaching || activeFeed.length === 0}
          className="rounded-lg px-2 py-2 text-xs font-semibold text-indigo-100 disabled:opacity-40"
        >
          {isCheckingRelevance ? "Reviewing..." : "Opus deep dive"}
        </button>
      </div>

      <details className="mt-3 overflow-hidden rounded-xl border border-white/[0.07] bg-black/15">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-3 text-xs font-medium text-ink-muted">
          Ask Opus about this list <ChevronDown className="h-4 w-4" />
        </summary>
        <div className="border-t border-white/[0.06] p-3">
          <div className="flex gap-2">
            <input
              value={askQuestion}
              onChange={event => setAskQuestion(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAskSentinel();
                }
              }}
              disabled={!aiReviewEnabled}
              className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent/60 disabled:opacity-40"
              placeholder="Ask about priorities or friction"
            />
            <button onClick={handleAskSentinel} disabled={!aiReviewEnabled || isAsking || isCoaching} className="rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-ink disabled:opacity-40">
              {isAsking ? "..." : "Ask"}
            </button>
          </div>

          {askAnswer && (
            <div className="mt-3 rounded-xl border border-accent/20 bg-black/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-200">{aiProvenanceLabel(askProvenance)}{askProvenance?.mode ? ` · ${askProvenance.mode}` : ""}</span>
                <button onClick={() => { setAskAnswer(""); setAskProvenance(null); }} className="text-ink-faint hover:text-ink" aria-label="Clear answer"><X className="h-4 w-4" /></button>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-muted">{askAnswer}</p>
            </div>
          )}
        </div>
      </details>

      <p className="mb-2 mt-4 text-xs font-semibold text-ink-muted">Context</p>
      <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-black/15">
        <button type="button" onClick={() => setActiveTab("signals")} className="flex w-full items-center justify-between border-b border-white/[0.06] px-3.5 py-3 text-left text-xs font-medium text-ink-muted">
          Full phone messages <ChevronDown className="h-4 w-4 -rotate-90" />
        </button>
        <button type="button" onClick={() => syncTelemetryLogs(true)} disabled={isSyncing} className="flex w-full items-center justify-between px-3.5 py-3 text-left text-xs font-medium text-ink-muted disabled:opacity-40">
          Refresh phone context <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
        </button>
      </div>
    </section>
  );

  const renderTaskCard = (task: ExecutiveTask) => {
    const situation = smartSituationByTaskId.get(task.id)
      || (task.associatedAnchorId ? smartSituationByTaskId.get(task.associatedAnchorId) : undefined);
    const sourceSignal = situation?.primarySignal
      || activeFeed.find(signal => task.sourceLogIds?.includes(signal.id));
    return (
      <SmartSuggestionCard
        key={task.id}
        task={task}
        situation={situation}
        sourceSignal={sourceSignal}
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
    <div className="min-h-screen text-slate-100">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-bg/92 pt-[max(.45rem,env(safe-area-inset-top))] backdrop-blur-2xl">
        <div className="mx-auto max-w-lg px-4">
          <div className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/[0.08] text-primary">
                <ShieldCheck className="h-[19px] w-[19px]" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-[16px] font-semibold leading-tight text-ink">Sentinel LifeOps</h1>
                <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint">
                  <span className={`h-1.5 w-1.5 rounded-full ${serverHealth?.modelProvider === "unreachable" ? "bg-danger" : serverHealth ? "bg-primary" : "bg-warn"}`} />
                  <span className={serverHealth && serverHealth.modelProvider !== "unreachable" ? "text-primary" : ""}>{serverHealth && serverHealth.modelProvider !== "unreachable" ? "Live" : serverHealth ? "Offline" : "Connecting"}</span>
                  <span>phone context</span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => syncTelemetryLogs(true)}
              disabled={isSyncing}
              className="flex shrink-0 items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.04] px-2.5 py-2 text-[11px] font-medium text-ink-muted disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-primary ${isSyncing ? "animate-spin" : ""}`} />
              {isSyncing ? "Syncing" : "Live telemetry"}
            </button>
          </div>

          <div className="flex items-center gap-2 pb-2.5">
            <span className="rounded-full border border-white/[0.07] bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-ink-muted">Quick mode</span>
            <button type="button" onClick={() => setActiveTab("tasks")} className="flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent-soft/45 px-2.5 py-1 text-[10px] font-medium text-indigo-100">
              <BrainCircuit className="h-3 w-3" /> Opus deep dive
            </button>
            <span className="ml-auto text-[10px] text-ink-faint">{taskReadySignals.length} ready</span>
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
            className={`fixed inset-x-3 bottom-[calc(5.8rem+env(safe-area-inset-bottom))] z-[45] mx-auto max-w-md rounded-2xl border px-3.5 py-3 shadow-2xl backdrop-blur-2xl ${
              notice.severity === "error" ? "border-rose-500/30 bg-rose-950/95 text-rose-100" :
              notice.severity === "warning" ? "border-amber-500/30 bg-amber-950/95 text-amber-100" :
              "border-cyan-500/20 bg-[#0b2d31]/95 text-cyan-100"
            }`}
          >
            <div className="flex items-start justify-between gap-3 text-xs">
              <span className="line-clamp-3 leading-relaxed">{notice.text}</span>
              <button onClick={() => setNotice(null)} className="rounded p-1 text-slate-300 hover:bg-white/10" aria-label="Dismiss message">
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="mx-auto max-w-lg px-4 pb-[calc(6.35rem+env(safe-area-inset-bottom))] pt-3.5">
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
              <>
                <section className="rounded-2xl border border-white/[0.08] bg-white/[0.045] p-4 shadow-card">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-semibold text-ink">{activeTask.estimatedDurationMinutes}m target <span className="font-normal text-ink-faint">· {activeTask.steps.filter(step => step.state === "done").length}/{activeTask.steps.length}</span></span>
                    <span className="rounded-full border border-accent/20 bg-accent-soft/40 px-2.5 py-1 font-medium text-indigo-100">Opus / Quick</span>
                  </div>
                  <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.07]">
                    <div className="h-full rounded-full bg-primary shadow-[0_0_10px_rgb(20_240_201_/_0.7)]" style={{ width: `${Math.round((activeTask.steps.filter(step => step.state === "done").length / Math.max(1, activeTask.steps.length)) * 100)}%` }} />
                  </div>
                  <h2 className="mt-3 line-clamp-2 text-[18px] font-semibold leading-6 text-ink">{normalizeHumanTaskTitle(activeTask.title, 84) || activeTask.title}</h2>
                  <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-ink-muted"><span className="font-medium text-primary">Next:</span> {normalizeHumanTaskTitle(nextStep?.title || activeTask.nextPhysicalAction, 110) || nextStep?.title || activeTask.nextPhysicalAction}</p>
                  {activeTask.targetTime && <p className="mt-2 text-xs text-ink-faint">Target {formatTo12Hour(activeTask.targetTime)}</p>}
                </section>

                <section className="space-y-2" aria-label="Task actions">
                  <ActionButton icon={Check} label="Step done" hint="Advance checklist" tone="green" onClick={handleMarkNextStepDone} disabled={!nextStep} />
                  <ActionButton icon={AlertTriangle} label="I'm stuck" hint="Simplify next actions" tone="amber" onClick={() => setShowStuckPanel(true)} />
                  <ActionButton icon={TimerReset} label="Running late" hint="Shrink the route" tone="red" onClick={handleRunningLate} />
                  <ActionButton icon={Crosshair} label="Focus" hint="Fullscreen current task" tone="cyan" onClick={() => setFocusModeOpen(true)} />
                </section>

                <details className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025]">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-ink-muted">
                    <span>Checklist</span>
                    <span className="flex items-center gap-2 text-xs text-ink-faint">{activeTask.steps.filter(step => step.state === "done").length}/{activeTask.steps.length} complete <ChevronDown className="h-4 w-4" /></span>
                  </summary>
                  <div className="border-t border-white/[0.06]">
                    {activeTask.steps.map((step, index) => (
                    <button
                      type="button"
                      key={step.id}
                      onClick={() => {
                        if (step.state === "done") return;
                        androidBridge?.openSourceApp?.(step.packageName || "", step.source || undefined);
                        updateTaskStepState(activeTask.id, step.id);
                      }}
                      className={`flex w-full items-start gap-3 border-b border-white/[0.06] p-3.5 text-left last:border-b-0 ${step.state === "current" ? "bg-primary/[0.06]" : ""}`}
                    >
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${step.state === "done" ? "bg-primary text-primary-ink" : step.state === "current" ? "border border-primary/60 text-primary" : "bg-white/[0.06] text-ink-faint"}`}>
                        {step.state === "done" ? <Check className="h-4 w-4" /> : index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm font-medium leading-5 ${step.state === "done" ? "text-ink-faint line-through" : "text-ink"}`}>{normalizeHumanTaskTitle(step.title, 110) || step.title}</span>
                        <span className="mt-0.5 block text-xs text-ink-faint">{step.durationMinutes} minutes</span>
                      </span>
                    </button>
                    ))}
                  </div>
                </details>

                <button
                  type="button"
                  onClick={() => handleAskOpus(activeTask)}
                  disabled={isCoaching}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-accent/25 bg-accent-soft/55 px-4 py-3 text-sm font-semibold text-indigo-50 disabled:opacity-45"
                >
                  <BrainCircuit className="h-4 w-4" /> Ask Opus to simplify this task
                </button>

                <details className="rounded-2xl border border-white/[0.07] bg-white/[0.025]">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 text-sm text-ink-muted">
                    Task options <ChevronDown className="h-4 w-4" />
                  </summary>
                  <div className="space-y-3 border-t border-white/[0.06] p-4">
                    <label className="block">
                      <span className="text-xs font-medium text-ink-muted">Target time</span>
                      <input type="time" value={activeTask.targetTime || ""} onChange={event => updateActiveTaskTargetTime(event.target.value)} className="mt-2 w-full rounded-xl border border-white/[0.08] bg-black/25 px-3 py-3 text-ink" />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setShowDelayModal(true)} className="rounded-xl border border-white/[0.08] px-3 py-3 text-sm font-medium text-ink-muted">Log delay</button>
                      <button type="button" onClick={handleFinishTask} className="rounded-xl bg-white/[0.08] px-3 py-3 text-sm font-medium text-ink"><CheckCircle2 className="mr-1.5 inline h-4 w-4" /> Finish task</button>
                    </div>
                  </div>
                </details>
              </>
            ) : visibleSuggestionTasks.length > 0 ? (
              <section>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Ready to act</p>
                    <h2 className="mt-1 text-xl font-semibold text-ink">One useful next task</h2>
                  </div>
                  <button onClick={() => setActiveTab("signals")} className="text-xs font-medium text-primary">See inbox</button>
                </div>
                <div className="mt-4">{renderTaskCard(visibleSuggestionTasks[0])}</div>
              </section>
            ) : (
              <section className="glass-panel rounded-3xl p-7 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Check className="h-6 w-6" /></div>
                <p className="mt-4 text-xl font-semibold text-ink">Nothing needs your attention</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-muted">Refresh the phone feed or add something already on your mind.</p>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => syncTelemetryLogs(true)} disabled={isSyncing} className="rounded-xl border border-white/[0.08] bg-white/[0.05] px-3 py-3 text-sm font-medium text-ink">{isSyncing ? "Refreshing..." : "Refresh"}</button>
                  <button type="button" onClick={() => setShowAddTaskModal(true)} className="rounded-xl bg-primary px-3 py-3 text-sm font-semibold text-primary-ink">Add task</button>
                </div>
              </section>
            )}

            {driftSignal && activeTask && (
              <section className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-amber-100">Possible distraction</p>
                    <p className="mt-1 text-xs text-amber-100/70">{cleanSignalFragment(driftSignal.title, 90)}</p>
                  </div>
                  <button type="button" onClick={handleReturnFromDrift} className="shrink-0 rounded-xl bg-amber-300 px-3 py-2 text-xs font-semibold text-amber-950">Return</button>
                </div>
              </section>
            )}
          </div>
        )}

        {activeTab === "tasks" && (
          <div className="space-y-4">
            <TaskList
              tasks={storedTasks}
              isLoading={isExtractingTasks && storedTasks.length === 0}
              fallbackWhyFor={task => smartSituationByTaskId.get(task.situationId || task.associatedAnchorId || task.id)?.why[0]}
              onToggleComplete={toggleTaskComplete}
              onToggleStep={toggleTaskStep}
              onDismiss={dismissStoredTask}
              onFocus={focusStoredTask}
              onAskOpus={handleAskOpus}
              onAdd={() => setShowAddTaskModal(true)}
              isCoaching={isCoaching}
            />

            {renderClaudeReviewPanel()}
            {renderRelevanceAuditPanel()}
          </div>
        )}

        {activeTab === "signals" && (
          <div className="space-y-4">
            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 shadow-card">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-[22px] font-semibold leading-tight text-ink">Inbox</h2>
                  <p className="mt-1 text-xs text-ink-muted">{taskReadySignals.length} task-ready signal{taskReadySignals.length === 1 ? "" : "s"}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/[0.08]">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${taskReadySignals.length === 0 ? 0 : Math.max(18, Math.min(100, (visibleSuggestionTasks.length / taskReadySignals.length) * 100))}%` }} />
                  </div>
                  <div className="relative h-10 w-10 rounded-full" style={{ background: "conic-gradient(var(--color-primary) 0 76%, rgb(255 255 255 / 0.08) 76% 100%)" }}>
                    <div className="absolute inset-[3px] flex items-center justify-center rounded-full bg-surface text-[10px] font-semibold text-primary">{Math.min(99, visibleSuggestionTasks.length)}</div>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 border-t border-white/[0.06] pt-3">
                <span className="rounded-full bg-primary/[0.1] px-2.5 py-1 text-[10px] font-medium text-primary">Quick mode</span>
                <span className="rounded-full border border-accent/20 bg-accent-soft/35 px-2.5 py-1 text-[10px] font-medium text-indigo-100">Opus deep dive</span>
                <button
                  type="button"
                  onClick={() => handleExtractTasks(false)}
                  disabled={isExtractingTasks || taskReadySignals.length === 0}
                  className="ml-auto flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-ink disabled:opacity-45"
                >
                  <Sparkles className="h-3.5 w-3.5" /> {isExtractingTasks ? "Organizing" : "Organize"}
                </button>
              </div>
            </section>

            <section className="space-y-2.5">
              {isExtractingTasks && [0, 1, 2].map(row => (
                <div key={row} className="animate-pulse rounded-2xl border border-white/[0.07] bg-white/[0.04] p-4">
                  <div className="h-4 w-3/4 rounded bg-white/[0.08]" />
                  <div className="mt-3 h-3 w-2/5 rounded bg-white/[0.06]" />
                </div>
              ))}
              {!isExtractingTasks && (visibleSuggestionTasks.length > 0 ? visibleSuggestionTasks.map(renderTaskCard) : (
                <EmptyState title="No suggestions yet" body={taskReadySignals.length > 0 ? "Signals are ready. Organize them into tasks when you are ready." : "Refresh to look for concrete requests, missed calls, deadlines, and appointments."} />
              ))}
            </section>

            <details className="rounded-2xl border border-white/[0.07] bg-white/[0.025]">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 text-sm font-medium text-ink-muted">Add a phone item manually <ChevronDown className="h-4 w-4" /></summary>
              <div className="border-t border-white/[0.06] p-4">
              <div className="grid gap-3 sm:grid-cols-[130px_1fr]">
                <label className="block">
                  <span className="text-xs font-medium text-ink-muted">Source</span>
                  <select
                    value={manualSignalSource}
                    onChange={event => setManualSignalSource(event.target.value as SentinelEvent["source"])}
                    className="mt-2 w-full rounded-xl border border-white/[0.08] bg-black/25 px-3 py-3 text-sm text-ink outline-none focus:border-primary/50"
                  >
                    <option value="sms">SMS</option>
                    <option value="notification">Notification</option>
                    <option value="calendar">Calendar</option>
                    <option value="screen_text">Screen text</option>
                    <option value="user_note">Note</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-ink-muted">Title</span>
                  <input
                    value={manualSignalTitle}
                    onChange={event => setManualSignalTitle(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/[0.08] bg-black/25 px-3 py-3 text-sm text-ink outline-none focus:border-primary/50"
                    placeholder="Who or what is this from?"
                  />
                </label>
              </div>
              <label className="mt-3 block">
                <span className="text-xs font-medium text-ink-muted">Phone text</span>
                <textarea
                  value={manualSignalContent}
                  onChange={event => setManualSignalContent(event.target.value)}
                  rows={4}
                  className="mt-2 w-full rounded-xl border border-white/[0.08] bg-black/25 px-3 py-3 text-sm text-ink outline-none focus:border-primary/50"
                  placeholder="Paste the real message, reminder, event, or screen text here."
                />
              </label>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={handleAddManualSignal}
                  className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-ink"
                >
                  Save and suggest
                </button>
              </div>
              </div>
            </details>

            <details className="rounded-2xl border border-white/[0.07] bg-white/[0.025]">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 text-sm font-medium text-ink-muted">Raw phone context <span className="flex items-center gap-2 text-xs text-ink-faint">{visibleSignals.length} signals <ChevronDown className="h-4 w-4" /></span></summary>
              <div className="space-y-2 border-t border-white/[0.06] p-3">
                {visibleSignals.length > 0 ? visibleSignals.map(renderSignalCard) : <EmptyState title="No phone context" body="Check Setup if LifeOps is not receiving phone data." />}
              </div>
            </details>
          </div>
        )}

        {activeTab === "access" && (
          <div className="space-y-4">
            <section className="glass-panel rounded-3xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Setup</p>
                  <h2 className="mt-1 text-xl font-semibold text-ink">{readyPermissionCount}/4 access groups ready</h2>
                  <p className="mt-1 text-xs leading-5 text-ink-muted">LifeOps needs these Android permissions to see useful phone signals.</p>
                </div>
                <button type="button" onClick={refreshAndroidStatus} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.05] text-ink-muted" aria-label="Refresh permission status"><RefreshCw className="h-4 w-4" /></button>
              </div>
            </section>

            <section className="grid gap-2.5 sm:grid-cols-2">
              {permissionItems.map(item => (
                <article key={item.key} className="rounded-2xl border border-white/[0.08] bg-white/[0.045] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-ink">{item.label}</h3>
                      <p className="mt-1.5 text-xs leading-5 text-ink-muted">{item.detail}</p>
                    </div>
                    <Pill tone={item.isReady ? "success" : "warn"}>{item.isReady ? "Ready" : "Needs setup"}</Pill>
                  </div>
                  <button
                    onClick={item.onAction}
                    disabled={!isAndroidBridgeAvailable}
                    className="mt-3 w-full rounded-xl border border-white/[0.08] bg-white/[0.055] px-3 py-2.5 text-left text-xs font-semibold text-ink disabled:opacity-45"
                  >
                    {isAndroidBridgeAvailable ? item.actionLabel : "Available on Android"}
                  </button>
                </article>
              ))}
            </section>

            <section className="rounded-2xl border border-violet-400/20 bg-violet-500/[0.06] p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-violet-300" />
                    <h3 className="text-base font-semibold text-ink">Spark coaching feed</h3>
                    <Pill tone={sparkDriveStatus?.configured ? "success" : "warn"}>
                      {sparkDriveStatus?.configured ? "Connected" : "Needs folder"}
                    </Pill>
                  </div>
                  <p className="mt-1.5 text-xs leading-5 text-ink-muted">
                    Every 12 hours, LifeOps writes a privacy-filtered scan of the rolling previous 24 hours to Google Drive for personalized Spark coaching.
                  </p>
                  {sparkDriveStatus?.folderName && (
                    <p className="mt-2 text-xs font-semibold text-violet-200">Folder: {sparkDriveStatus.folderName}</p>
                  )}
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 text-xs">
                  <p className="text-slate-500">Schedule</p>
                  <p className="font-bold text-ink">Every {sparkDriveStatus?.scheduleHours || 12} hours</p>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 text-xs">
                  <p className="text-slate-500">Last export</p>
                  <p className="font-bold text-ink">{sparkDriveStatus?.lastExportAt ? formatRelativeTime(sparkDriveStatus.lastExportAt) : "Not yet"}</p>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 text-xs">
                  <p className="text-slate-500">Signals delivered</p>
                  <p className="font-bold text-ink">{sparkDriveStatus?.lastExportCount || 0}</p>
                </div>
              </div>

              {sparkDriveStatus?.lastExportError && (
                <p className="mt-3 rounded-xl border border-rose-400/20 bg-rose-950/20 px-3 py-2 text-xs text-rose-100">
                  Last export: {sparkDriveStatus.lastExportError}
                </p>
              )}

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <ActionButton
                  icon={FolderOpen}
                  label={sparkDriveStatus?.configured ? "Change Drive folder" : "Choose Drive folder"}
                  hint="One-time Google Drive access"
                  tone="slate"
                  disabled={!isAndroidBridgeAvailable || !androidBridge?.chooseSparkDriveFolder}
                  onClick={() => {
                    androidBridge?.chooseSparkDriveFolder?.();
                    setNotice({ text: "Choose the LifeOps Spark Coaching folder in Google Drive.", severity: "info" });
                  }}
                />
                <ActionButton
                  icon={CloudUpload}
                  label={isExportingSparkDrive ? "Exporting..." : "Export now"}
                  hint="Refresh the rolling 24-hour feed"
                  disabled={!sparkDriveStatus?.configured || isExportingSparkDrive || !androidBridge?.exportSparkDriveNowJson}
                  onClick={exportSparkDriveNow}
                />
              </div>
              <p className="mt-3 text-[11px] leading-4 text-ink-faint">
                Monarch work and clinical content (including Credible), plus authenticator, password-manager, password, token, private-key, and MFA-like content, is excluded before Drive. Personal Microsoft activity remains available for coaching.
              </p>
            </section>

            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-base font-semibold text-ink">Server &amp; AI health</h3>
                  <p className="mt-1.5 text-xs leading-5 text-ink-muted">
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
                    <div className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 text-xs">
                    <p className="text-slate-500">Provider</p>
                    <p className="font-bold text-ink">{serverHealth.modelProvider || "unknown"}</p>
                  </div>
                    <div className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 text-xs">
                    <p className="text-slate-500">Runtime</p>
                    <p className="font-bold text-ink">{serverHealth.modelRuntimeStatus || "unknown"}</p>
                  </div>
                    <div className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 text-xs">
                    <p className="text-slate-500">Routine model</p>
                    <p className="font-bold text-ink">{serverHealth.fastModel || serverHealth.model || "Not reported"}</p>
                  </div>
                    <div className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 text-xs">
                    <p className="text-slate-500">Deep model</p>
                    <p className="font-bold text-ink">{serverHealth.deepModel || "Opus"}</p>
                  </div>
                    <div className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 text-xs">
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
                    <div className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 text-xs">
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

            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
              <h3 className="text-base font-semibold text-ink">Android bridge</h3>
              <p className="mt-1.5 text-xs leading-5 text-ink-muted">{isAndroidBridgeAvailable ? "The installed app is connected and can read approved phone sources." : "Browser preview cannot read phone data directly."}</p>
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
                          <div key={flag.key} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 text-xs">
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

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.07] bg-[#080d17]/96 pb-[max(.35rem,env(safe-area-inset-bottom))] backdrop-blur-2xl" aria-label="Primary navigation">
        <div className="mx-auto grid max-w-lg grid-cols-4 px-2 pt-1.5">
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
                type="button"
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                className={`relative flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-2xl text-[10px] font-medium transition-colors ${active ? "text-primary" : "text-ink-faint hover:text-ink"}`}
                aria-current={active ? "page" : undefined}
              >
                <span className={`relative flex h-7 w-10 items-center justify-center rounded-xl transition-colors ${active ? "bg-primary/[0.1]" : ""}`}>
                  <Icon className={`h-[19px] w-[19px] ${active ? "fill-primary/15" : ""}`} strokeWidth={active ? 2.4 : 1.8} />
                  {item.key === "signals" && taskReadySignals.length > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[8px] font-bold text-primary-ink">{Math.min(99, taskReadySignals.length)}</span>
                  )}
                </span>
                <span>{item.label}</span>
                {active && <motion.span layoutId="active-tab" className="absolute inset-x-7 top-0 h-0.5 rounded-full bg-primary shadow-[0_0_10px_rgb(20_240_201_/_0.75)]" />}
              </button>
            );
          })}
        </div>
      </nav>

      {coachTask && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/75 p-3 backdrop-blur-sm sm:items-center sm:justify-center">
          <section className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-accent/30 bg-[#0d1422] shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-white/[0.07] bg-[#0d1422]/95 p-4 backdrop-blur-xl">
              <div>
                <div className="flex items-center gap-2 text-accent"><BrainCircuit className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wide">Opus task coach</span></div>
                <h2 className="mt-1.5 text-lg font-semibold leading-6 text-ink">{coachTask.title}</h2>
              </div>
              <button type="button" onClick={() => { setCoachTask(null); setCoachPlan(null); }} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-ink-muted" aria-label="Close Opus plan"><X className="h-4 w-4" /></button>
            </div>

            <div className="p-4">
              {isCoaching && (
                <div className="py-10 text-center">
                  <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-accent/20 border-t-accent" />
                  <p className="mt-4 text-sm text-ink-muted">Building a smaller, more realistic route...</p>
                </div>
              )}

              {coachPlan && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-primary/20 bg-primary/[0.06] p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">Start here</p>
                    <p className="mt-1.5 text-base font-medium leading-6 text-ink">{coachPlan.firstStep}</p>
                    <p className="mt-2 text-xs leading-5 text-ink-muted">{coachPlan.summary}</p>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-ink">Small chunks</h3>
                    <ol className="mt-2 space-y-2">
                      {coachPlan.chunks.map((chunk, index) => (
                        <li key={`${chunk.title}-${index}`} className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-indigo-100">{index + 1}</span>
                          <span className="min-w-0 flex-1 text-sm text-ink">{chunk.title}</span>
                          <span className="text-xs text-ink-faint">{chunk.minutes}m</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4">
                    <h3 className="text-sm font-semibold text-ink">Low-energy version</h3>
                    <p className="mt-1.5 text-sm leading-6 text-ink-muted">{coachPlan.lowEnergyVersion}</p>
                  </div>

                  {coachPlan.frictionPlan.length > 0 && (
                    <div className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.045] p-4">
                      <h3 className="text-sm font-semibold text-amber-100">If something gets in the way</h3>
                      <div className="mt-2 space-y-2">
                        {coachPlan.frictionPlan.map((item, index) => <p key={index} className="text-xs leading-5 text-amber-50/75"><span className="font-semibold text-amber-100">{item.friction}:</span> {item.response}</p>)}
                      </div>
                    </div>
                  )}

                  {coachPlan.behavioralActivation && (
                    <div className="rounded-2xl border border-primary/15 bg-primary/[0.035] p-4">
                      <h3 className="text-sm font-semibold text-ink">Behavioral activation</h3>
                      <dl className="mt-2 space-y-2 text-xs leading-5 text-ink-muted">
                        <div><dt className="font-semibold text-ink">Why it matters</dt><dd>{coachPlan.behavioralActivation.valueLink}</dd></div>
                        <div><dt className="font-semibold text-ink">Graded start</dt><dd>{coachPlan.behavioralActivation.gradedStart}</dd></div>
                        <div><dt className="font-semibold text-ink">Suggested window</dt><dd>{coachPlan.behavioralActivation.scheduledWindow}</dd></div>
                      </dl>
                    </div>
                  )}

                  {coachPlan.habitPlan && (
                    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4">
                      <h3 className="text-sm font-semibold text-ink">Make it repeatable</h3>
                      <p className="mt-2 text-xs leading-5 text-ink-muted"><span className="font-semibold text-ink">Cue:</span> {coachPlan.habitPlan.cue}</p>
                      <p className="mt-1 text-xs leading-5 text-ink-muted"><span className="font-semibold text-ink">Routine:</span> {coachPlan.habitPlan.routine}</p>
                      <p className="mt-1 text-xs leading-5 text-ink-muted"><span className="font-semibold text-ink">Reward:</span> {coachPlan.habitPlan.reward}</p>
                    </div>
                  )}

                  <p className="text-center text-[10px] text-ink-faint">Generated by {coachPlan.model || "Opus"}. Review before applying.</p>
                  <div className="grid grid-cols-2 gap-2 pb-[max(0rem,env(safe-area-inset-bottom))]">
                    <button type="button" onClick={() => { setCoachTask(null); setCoachPlan(null); }} className="rounded-xl border border-white/[0.08] px-4 py-3 text-sm font-medium text-ink-muted">Keep current</button>
                    <button type="button" onClick={handleApplyCoachPlan} className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-ink">Use this plan</button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {showStuckPanel && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/75 p-3 backdrop-blur-sm sm:items-center sm:justify-center">
          <div className="w-full max-w-lg rounded-3xl border border-amber-400/25 bg-[#0d1422] p-5 shadow-2xl">
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
                  className="flex w-full items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 text-left hover:border-primary/40"
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
        <div className="fixed inset-0 z-50 flex items-end bg-black/75 p-3 backdrop-blur-sm sm:items-center sm:justify-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/[0.1] bg-[#0d1422] p-5 shadow-2xl">
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
                <input value={newTaskTitle} onChange={event => setNewTaskTitle(event.target.value)} className="mt-2 w-full rounded-xl border border-white/[0.09] bg-black/25 px-3 py-3 text-ink outline-none focus:border-primary/50" placeholder="What needs to happen?" />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-slate-300">First physical action</span>
                <input value={newTaskNextPhysical} onChange={event => setNewTaskNextPhysical(event.target.value)} className="mt-2 w-full rounded-xl border border-white/[0.09] bg-black/25 px-3 py-3 text-ink outline-none focus:border-primary/50" placeholder="The first thing your body does" />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-slate-300">Estimated minutes</span>
                <input type="number" min={5} value={newTaskDuration} onChange={event => setNewTaskDuration(Number(event.target.value) || 15)} className="mt-2 w-full rounded-xl border border-white/[0.09] bg-black/25 px-3 py-3 text-ink outline-none focus:border-primary/50" />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-slate-300">Target time</span>
                <input type="time" value={newTaskTargetTime} onChange={event => setNewTaskTargetTime(event.target.value)} className="mt-2 w-full rounded-xl border border-white/[0.09] bg-black/25 px-3 py-3 text-ink outline-none focus:border-primary/50" />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-slate-300">Steps</span>
                <textarea value={newStepsInput} onChange={event => setNewStepsInput(event.target.value)} rows={4} className="mt-2 w-full rounded-xl border border-white/[0.09] bg-black/25 px-3 py-3 text-ink outline-none focus:border-primary/50" placeholder="One step per line. Optional: add minutes like (10m)." />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setShowAddTaskModal(false)} className="rounded-lg px-4 py-3 text-sm font-bold text-slate-300 hover:bg-slate-800">Cancel</button>
              <button onClick={handleCreateTask} className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-ink">Make current task</button>
            </div>
          </div>
        </div>
      )}

      {showDelayModal && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/75 p-3 backdrop-blur-sm sm:items-center sm:justify-center">
          <div className="w-full max-w-lg rounded-3xl border border-white/[0.1] bg-[#0d1422] p-5 shadow-2xl">
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
              <button onClick={handleCreateDelayNote} className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-ink">Save delay note</button>
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
