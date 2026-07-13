export type AnchorStatus = "draft" | "tentative" | "confirmed" | "canceled" | "revised";
export type ConfidenceLevel = "low" | "medium" | "high";
export type RecommendedAction =
  | "add to calendar"
  | "ask user"
  | "ignore"
  | "update existing event"
  | "cancel existing event";

export type SentinelSource =
  | "sms"
  | "notification"
  | "calendar"
  | "location"
  | "app_usage"
  | "screen_text"
  | "user_note";

export interface TimeAnchor {
  id: string;
  title: string;
  person: string;
  raw_excerpt: string;
  inferred_date: string;
  inferred_time?: string | null;
  location?: string | null;
  confidence: ConfidenceLevel;
  status: AnchorStatus;
  needs_confirmation: boolean;
  recommended_action: RecommendedAction;
}

export type ExecutiveStepState = "current" | "pending" | "done";

export interface ExecutiveStep {
  id: string;
  title: string;
  durationMinutes: number;
  state: ExecutiveStepState;
  // If present, tapping this step can launch the originating Android app.
  packageName?: string | null;
  source?: SentinelSource | null;
}

export interface ReverseStep {
  id: string;
  label: string;
  durationMinutes: number;
  absoluteTime: string;
  isActionable: boolean;
  type: "prep" | "travel" | "buffer" | "anchor";
  isCompleted: boolean;
}

export type TaskUrgency = "now" | "soon" | "later";

export interface AppliedCoachGuidance {
  summary: string;
  lowEnergyVersion: string;
  frictionPlan: Array<{ friction: string; response: string }>;
  habitPlan?: { cue: string; routine: string; reward: string } | null;
  behavioralActivation?: { valueLink: string; gradedStart: string; scheduledWindow: string } | null;
  generatedAtEpochMillis: number;
  engine?: string;
  model?: string;
}

export interface ExecutiveTask {
  id: string;
  title: string;
  estimatedDurationMinutes: number;
  isCompleted: boolean;
  associatedAnchorId?: string | null;
  targetTime?: string | null;
  avoidanceTarget: string;
  nextPhysicalAction: string;
  steps: ExecutiveStep[];
  // AI-authored context (optional, additive): why the task exists, grounded in the
  // telemetry evidence, plus traceability back to the signals it came from.
  why?: string;
  urgency?: TaskUrgency;
  sourceLogIds?: string[];
  situationId?: string | null;
  // Saved when an on-demand coaching plan is applied, so the useful fallback
  // guidance remains attached to the task without another model request.
  coachGuidance?: AppliedCoachGuidance;
}

export type StoredTaskStatus = "open" | "done" | "dismissed";

// A task as persisted in the shared task list (server Postgres + client localStorage).
// updatedAtEpochMillis drives newer-wins merge between client and server.
export interface StoredTask extends ExecutiveTask {
  status: StoredTaskStatus;
  createdAtEpochMillis: number;
  updatedAtEpochMillis: number;
  completedAtEpochMillis?: number | null;
}

export interface SentinelEvent {
  id: string;
  timestamp: string;
  source: SentinelSource;
  title: string;
  content: string;
  relevanceScore?: number;
  relevanceReason?: string;
  capturedAtEpochMillis?: number;
  packageName?: string;
  metadata?: Record<string, unknown>;
}

export interface SlipAutopsy {
  id: string;
  task_id: string;
  what_slipped: string;
  expected_duration: number;
  actual_duration: number;
  hidden_steps: string;
  interruption_point: string;
  future_fix: string;
  created_at: string;
}
