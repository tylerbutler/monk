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
});
export type PlayerSnapshot = z.infer<typeof snapshotSchema>;
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };
