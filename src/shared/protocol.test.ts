import { expect, it } from "vitest";
import { parseClientMessage, parseServerMessage, parametersSchema } from "./protocol";
import { checkpointEngine } from "../worker/engine";
import { parameters, pulse, runningFixture } from "../../test/fixtures";

it("rejects a client-selected host role and internal joins", () => {
  expect(parseClientMessage({ version: 1, type: "host_command", commandId: "test-1", role: "host",
    command: { type: "set_faction", playerId: "p1", faction: "rock" } }).ok).toBe(false);
  expect(parseClientMessage({ version: 1, type: "host_command", commandId: "test-1",
    command: { type: "join", playerId: "p1", faction: "rock" } }).ok).toBe(false);
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
