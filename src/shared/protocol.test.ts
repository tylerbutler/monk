import { expect, it } from "vitest";
import { channelJoinSchema, joinReplySchema, parseClientMessage, parseServerMessage, parametersSchema } from "./protocol";
import { snapshotFor } from "../worker/engine";
import { checkpointEngine } from "../worker/engine";
import { parameters, pulse, runningFixture } from "../../test/fixtures";

it("rejects a client-selected host role and internal joins", () => {
  expect(parseClientMessage({ version: 1, type: "host_command", commandId: "test-1", role: "host",
    command: { type: "set_faction", playerId: "p1", faction: "rock" } }).ok).toBe(false);
  expect(parseClientMessage({ version: 1, type: "host_command", commandId: "test-1",
    command: { type: "join", playerId: "p1", faction: "rock" } }).ok).toBe(false);
});
it("validates credentials only in strict channel joins", () => {
  const credentials = { hostToken: "h".repeat(64), playerToken: null };
  expect(channelJoinSchema.safeParse(credentials).success).toBe(true);
  expect(channelJoinSchema.safeParse({ ...credentials, role: "host" }).success).toBe(false);
  expect(channelJoinSchema.safeParse({ ...credentials, hostToken: "short" }).success).toBe(false);
  expect(parseClientMessage({ version: 1, type: "authenticate", ...credentials }).ok).toBe(false);
});
it("requires a complete snapshot in a strict join reply", () => {
  const reply = { identity: { playerId: "p1", canHost: true, expiresAtMs: 10000 },
    state: { version: 1, type: "snapshot", streamId: "stream", streamSeq: 1,
      snapshot: snapshotFor(runningFixture(["rock", "paper"]), "p1", 0), trial: null, startChecking: false } };
  expect(joinReplySchema.safeParse(reply).success).toBe(true);
  expect(joinReplySchema.safeParse({ ...reply, state: {} }).success).toBe(false);
  expect(joinReplySchema.safeParse({ ...reply, token: "secret" }).success).toBe(false);
});
it("accepts a versioned authorized-command shape, but not invalid coordinates", () => {
  expect(parseClientMessage({ version: 1, type: "host_command", commandId: "test-1",
    command: { type: "pause" } }).ok).toBe(true);
  expect(parseClientMessage({ version: 1, type: "position",
    report: { seq: 1, capturedAtMs: 1, latitude: 91, longitude: 0, accuracyM: 1 } }).ok).toBe(false);
  expect(parseServerMessage({ version: 2, type: "snapshot" }).ok).toBe(false);
});
it("stores no location or dwell in a checkpoint", () => {
  const record = checkpointEngine(pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state, 0);
  expect(JSON.stringify(record)).not.toMatch(/latitude|longitude|capturedAtMs|dwellStart/);
  expect(record).not.toHaveProperty("playArea");
});
it("accepts round configuration without play-area metadata", () => {
  expect(parseClientMessage({ version: 1, type: "host_command", commandId: "configure-1",
    command: { type: "configure", mode: "test", parameters, approved: false,
      deviceLimitations: "Synthetic tests only" } }).ok).toBe(true);
});
it("rejects invalid tracking parameters", () => {
  expect(parametersSchema.safeParse({ entryRadiusM: 12, retentionRadiusM: 10,
    maxAccuracyM: 3, freshnessMs: 1500, dwellMs: 3000, graceMs: 2000, roundDurationMs: 600000 }).success).toBe(false);
});
it.each([0, 29999, 30000, 60000, null])("accepts known or unknown position age %s", reportedAgeMs => {
  expect(parseClientMessage({ version: 1, type: "position", report: {
    seq: 1, capturedAtMs: 1, latitude: 0, longitude: 0, accuracyM: 100, reportedAgeMs,
  } }).ok).toBe(true);
});
it.each([-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])("rejects invalid position age %s", reportedAgeMs => {
  expect(parseClientMessage({ version: 1, type: "position", report: {
    seq: 1, capturedAtMs: 1, latitude: 0, longitude: 0, accuracyM: 1, reportedAgeMs,
  } }).ok).toBe(false);
});
