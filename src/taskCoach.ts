import { z } from "zod";

const optionalText = (maxLength: number) => z.string().trim().max(maxLength).optional();
const nullableText = (maxLength: number) => z.string().trim().max(maxLength).nullable().optional();

const taskStepSchema = z.object({
  id: optionalText(160),
  title: z.string().trim().min(1).max(160),
  durationMinutes: z.number().finite().min(1).max(480).optional(),
  state: optionalText(40),
}).strict();

const coachTaskSchema = z.object({
  id: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(180),
  targetTime: nullableText(40),
  avoidanceTarget: optionalText(180),
  nextPhysicalAction: optionalText(220),
  steps: z.array(taskStepSchema).max(8).default([]),
}).strict();

const coachContextSchema = z.object({
  id: optionalText(180),
  timestamp: optionalText(80),
  source: optionalText(60),
  title: optionalText(160),
  content: optionalText(500),
  relevanceScore: z.number().finite().optional(),
  relevanceReason: optionalText(220),
  capturedAtEpochMillis: z.number().finite().optional(),
  packageName: optionalText(200),
}).strict();

export const taskCoachRequestSchema = z.object({
  task: coachTaskSchema,
  context: z.array(coachContextSchema).max(6).default([]),
  mode: z.literal("deep").default("deep"),
}).strict();

const coachChunkSchema = z.object({
  title: z.string().trim().min(1).max(180),
  minutes: z.coerce.number().finite().int().min(1).max(180),
}).strict();

const frictionItemSchema = z.object({
  friction: z.string().trim().min(1).max(220),
  response: z.string().trim().min(1).max(320),
}).strict();

const habitPlanSchema = z.object({
  cue: z.string().trim().min(1).max(220),
  routine: z.string().trim().min(1).max(320),
  reward: z.string().trim().min(1).max(220),
}).strict();

const behavioralActivationSchema = z.object({
  valueLink: z.string().trim().min(1).max(320),
  gradedStart: z.string().trim().min(1).max(320),
  scheduledWindow: z.string().trim().min(1).max(180),
}).strict();

export const taskCoachPlanSchema = z.object({
  summary: z.string().trim().min(1).max(800),
  firstStep: z.string().trim().min(1).max(220),
  chunks: z.array(coachChunkSchema).min(2).max(6),
  lowEnergyVersion: z.string().trim().min(1).max(500),
  frictionPlan: z.array(frictionItemSchema).min(1).max(5),
  habitPlan: habitPlanSchema.nullable().optional(),
  behavioralActivation: behavioralActivationSchema.nullable().optional(),
}).strict();

export type TaskCoachRequest = z.infer<typeof taskCoachRequestSchema>;
export type TaskCoachPlan = z.infer<typeof taskCoachPlanSchema>;
