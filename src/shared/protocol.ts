import { z } from "zod";

export const factionSchema = z.enum(["rock", "paper", "scissors"]);
export type Faction = z.infer<typeof factionSchema>;

const id = z.string().min(1).max(128);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = z.number().finite().positive();
export const modeSchema = z.enum(["test", "normal"]);
export const phaseSchema = z.enum(["lobby", "running", "paused", "ended"]);
export type MatchMode = z.infer<typeof modeSchema>;
export type MatchPhase = z.infer<typeof phaseSchema>;
export const parametersSchema = z.strictObject({
  entryRadiusM: positive.max(10000), retentionRadiusM: positive.max(10000),
  maxAccuracyM: positive.max(10000), freshnessMs: positive.int().max(60000),
  dwellMs: positive.int().max(86400000), graceMs: positive.int().max(86400000),
  roundDurationMs: positive.int().max(86400000),
}).refine(p => p.retentionRadiusM >= p.entryRadiusM, { message: "Retention radius must be at least the entry radius." });
export type RuleParameters = z.infer<typeof parametersSchema>;
export const positionSchema = z.strictObject({
  seq: time, capturedAtMs: time, latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180), accuracyM: positive.max(100000),
});
export type PositionReport = z.infer<typeof positionSchema>;
export const observationSchema = positionSchema.extend({ playerId: id, expiresAtMs: time });
export type Observation = z.infer<typeof observationSchema>;
export const actorSchema = z.strictObject({ id, host: z.boolean(), playerId: id.nullable() });
export type VerifiedActor = z.infer<typeof actorSchema>;
export const configureSchema = z.strictObject({
  type: z.literal("configure"), mode: modeSchema, parameters: parametersSchema,
  approved: z.boolean(), deviceLimitations: z.string().max(1000), playArea: z.string().min(1).max(1000),
});
export const hostCommandSchema = z.discriminatedUnion("type", [
  configureSchema,
  z.strictObject({ type: z.literal("start") }),
  z.strictObject({ type: z.literal("pause") }),
  z.strictObject({ type: z.literal("begin_resume") }),
  z.strictObject({ type: z.literal("cancel_resume") }),
  z.strictObject({ type: z.literal("end") }),
  z.strictObject({ type: z.literal("set_faction"), playerId: id, faction: factionSchema }),
]);
export const domainCommandSchema = z.union([
  hostCommandSchema,
  z.strictObject({ type: z.literal("join"), playerId: id, faction: factionSchema, label: z.string().min(1).max(80) }),
  z.strictObject({ type: z.literal("leave"), playerId: id }),
]);
export type HostCommand = z.infer<typeof hostCommandSchema>;
export type DomainCommand = z.infer<typeof domainCommandSchema>;
export const engineInputSchema = z.strictObject({
  nowMs: time, actor: actorSchema.nullable(), commands: z.array(domainCommandSchema).max(100),
  observations: z.array(observationSchema).max(100),
});
export type EngineInput = z.infer<typeof engineInputSchema>;
export const eventSchema = z.strictObject({
  type: z.enum(["conversion", "manual_faction_change", "attack_started", "attack_interrupted", "lifecycle"]),
  attackerId: id.nullable(), targetId: id.nullable(), faction: factionSchema.nullable(),
  reason: z.string().nullable(), hostId: id.nullable(), oldFaction: factionSchema.nullable(),
  eventSeq: time, atMs: time,
});
export type EngineEvent = z.infer<typeof eventSchema>;
const playerSchema = z.strictObject({ id, label: z.string().max(80), faction: factionSchema, graceMs: time });
export const checkpointSchema = z.strictObject({
  id, hostId: id, createdAtMs: time, phase: phaseSchema, mode: modeSchema,
  parameters: parametersSchema.nullable(), approved: z.boolean(),
  deviceLimitations: z.string().max(1000), playArea: z.string().max(1000),
  players: z.array(playerSchema).max(100), remainingMs: time, eventSeq: time,
});
export type EngineCheckpoint = z.infer<typeof checkpointSchema>;
const progressSchema = z.strictObject({ attackerId: id, targetId: id, progress: z.number().min(0).max(1) });
export const feedbackSummarySchema = z.strictObject({
  intended: time, acknowledged: time, missing: time,
  conversions: time, conversionsWithinOneSecond: time, conversionsFailed: time, conversionsPending: time,
  p95UpperMs: z.number().nonnegative().nullable(),
});
export type FeedbackSummary = z.infer<typeof feedbackSummarySchema>;
export const snapshotSchema = z.strictObject({
  matchId: id, phase: phaseSchema, mode: modeSchema,
  ownPlayerId: id.nullable(), ownFaction: factionSchema.nullable(),
  roster: z.array(playerSchema.extend({ active: z.boolean() })),
  remainingMs: time, graceMs: time.nullable(),
  outgoing: progressSchema.nullable(), incoming: z.array(progressSchema),
  nearby: z.strictObject({ rock: time, paper: time, scissors: time }),
  qualityReasons: z.array(z.string()), parameters: parametersSchema.nullable(),
  approved: z.boolean(), deviceLimitations: z.string(), playArea: z.string(),
  resumeChecking: z.boolean(), canHost: z.boolean(),
  feedback: feedbackSummarySchema.optional(),
});
export type PlayerSnapshot = z.infer<typeof snapshotSchema>;
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const token = z.string().min(32).max(128);
export const sessionCredentialsSchema = z.strictObject({
  matchCode: z.string().regex(/^[A-Z2-9]{8}$/), hostToken: token.nullable(), playerToken: token.nullable(),
});
export type SessionCredentials = z.infer<typeof sessionCredentialsSchema>;
export const clockSchema = z.strictObject({ offsetMs: z.number().finite(), uncertaintyMs: z.number().nonnegative().max(1000), measuredAtMs: time });
export type ClockEstimate = z.infer<typeof clockSchema>;
export type ClockProbeSample = { clientSendMs: number; serverReceiveMs: number; serverSendMs: number; clientReceiveMs: number };
export const trialStatusSchema = z.strictObject({
  playerIds: z.tuple([id, id]), readyIds: z.array(id).max(2),
  collecting: z.boolean(), referenceM: z.number().finite().nonnegative().max(10000).nullable(),
});
export type TrialStatus = z.infer<typeof trialStatusSchema>;
export const trialSampleSchema = z.strictObject({
  atMs: time, distanceM: z.number().finite().nonnegative(),
  uncertaintiesM: z.tuple([positive, positive]),
  agesMs: z.tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative()]), updateGapsMs: z.tuple([time, time]),
  delayBoundsMs: z.tuple([z.tuple([z.number().finite(), z.number().finite()]), z.tuple([z.number().finite(), z.number().finite()])]),
  clockUncertaintiesMs: z.tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative()]),
  referenceM: z.number().finite().nonnegative().nullable(),
});
export type TrialSample = z.infer<typeof trialSampleSchema>;
const envelope = { version: z.literal(1) };
export const clientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...envelope, type: z.literal("authenticate"), hostToken: token.nullable(), playerToken: token.nullable() }),
  z.strictObject({ ...envelope, type: z.literal("clock_probe"), nonce: id, clientSendMs: time }),
  z.strictObject({ ...envelope, type: z.literal("clock_confirm"), nonce: id, clientReceiveMs: time }),
  z.strictObject({ ...envelope, type: z.literal("position"), report: positionSchema }),
  z.strictObject({ ...envelope, type: z.literal("suspend"), reason: z.string().min(1).max(160) }),
  z.strictObject({ ...envelope, type: z.literal("leave") }),
  z.strictObject({ ...envelope, type: z.literal("host_command"), commandId: id, command: hostCommandSchema }),
  z.strictObject({ ...envelope, type: z.literal("snapshot_request") }),
  z.strictObject({ ...envelope, type: z.literal("feedback_seen"), eventSeq: time }),
  z.strictObject({ ...envelope, type: z.literal("trial_begin"), playerIds: z.tuple([id, id]), referenceM: z.number().nonnegative().max(10000).nullable() }),
  z.strictObject({ ...envelope, type: z.literal("trial_ready"), consent: z.boolean() }),
  z.strictObject({ ...envelope, type: z.literal("trial_end") }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export const outcomeSchema = z.strictObject({ commandId: id, accepted: z.boolean(), reason: z.string() });
export type CommandOutcome = z.infer<typeof outcomeSchema>;
const stream = { ...envelope, streamId: id, streamSeq: time };
const stateMessage = {
  snapshot: snapshotSchema, trial: trialStatusSchema.nullable(), startChecking: z.boolean(),
};
export const serverMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...stream, type: z.literal("authenticated"), playerId: id.nullable(), canHost: z.boolean(), expiresAtMs: time }),
  z.strictObject({ ...stream, type: z.literal("clock_reply"), nonce: id, clientSendMs: time, serverReceiveMs: time, serverSendMs: time }),
  z.strictObject({ ...stream, type: z.literal("clock_ready"), clock: clockSchema }),
  z.strictObject({ ...stream, type: z.literal("snapshot"), ...stateMessage }),
  z.strictObject({ ...stream, type: z.literal("update"), ...stateMessage, events: z.array(eventSchema), outcome: outcomeSchema.nullable() }),
  z.strictObject({ ...stream, type: z.literal("trial_sample"), sample: trialSampleSchema }),
  z.strictObject({ ...stream, type: z.literal("error"), code: id, reason: z.string(), commandId: id.nullable() }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type ServerBody = ServerMessage extends infer M ? M extends ServerMessage ? Omit<M, "version" | "streamId" | "streamSeq"> : never : never;
export function parseClientMessage(input: unknown): ParseResult<ClientMessage> {
  const parsed = clientMessageSchema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "Invalid client message. Check its version, fields, and values." };
}
export function parseServerMessage(input: unknown): ParseResult<ServerMessage> {
  const parsed = serverMessageSchema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "Invalid server message. Reconnect to this match." };
}
export type ConnectionStatus = { state: "connecting" | "connected" | "reconnecting" | "failed"; reason: string | null };
export type ConnectionHandlers = { onMessage(message: ServerMessage): void; onStatus(status: ConnectionStatus): void };
export type MatchConnection = { send(message: ClientMessage): void; close(): void };
export type LocationStatus = {
  collecting: boolean; permission: "unknown" | "granted" | "denied";
  visible: boolean; wakeLock: "unsupported" | "pending" | "held" | "released";
  reason: string | null;
};

const distributionSchema = z.strictObject({
  count: time, min: z.number().finite().nullable(), max: z.number().finite().nullable(),
  mean: z.number().finite().nullable(), bounds: z.array(z.number().finite()), counts: z.array(time),
});
export type Distribution = z.infer<typeof distributionSchema>;
const referenceSummarySchema = z.strictObject({
  referenceM: z.number().nonnegative().nullable(), count: time,
  signedErrorM: distributionSchema, absoluteErrorM: distributionSchema,
  uncertaintiesM: z.tuple([distributionSchema, distributionSchema]),
  agesMs: z.tuple([distributionSchema, distributionSchema]),
  updateGapsMs: z.tuple([distributionSchema, distributionSchema]),
  captureToReceiptLowerMs: z.tuple([distributionSchema, distributionSchema]),
  captureToReceiptUpperMs: z.tuple([distributionSchema, distributionSchema]),
  clockUncertaintiesMs: z.tuple([distributionSchema, distributionSchema]),
});
export const deviceSchema = z.strictObject({
  model: z.string().trim().min(1).max(80), os: z.string().trim().min(1).max(80),
  mode: z.enum(["Safari tab", "Installed PWA", "Other browser"]),
});
export const trialReportSchema = z.strictObject({
  version: z.literal(1), devices: z.tuple([deviceSchema, deviceSchema]),
  conditions: z.string().trim().min(1).max(500), sampleCount: time,
  references: z.array(referenceSummarySchema),
  candidates: z.array(z.strictObject({
    parameters: parametersSchema, falseEntrySamples: time, interruptions: time, eligibleSamples: time,
  })),
  limitations: z.array(z.string()),
});
export type TrialReport = z.infer<typeof trialReportSchema>;
export type TrialSummary = TrialReport & { runtime: { lastAtMs: number | null; inside: boolean[] } };
