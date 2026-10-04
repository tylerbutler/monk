import { locationInactivityMs } from "../shared/protocol";
import type { Observation, PositionReport } from "../shared/protocol";

export type KnownPosition = { report: PositionReport; receivedAtMs: number; sharing: boolean };

export function positionAgeMs(position: KnownPosition, nowMs: number): number | null {
  const age = position.report.reportedAgeMs;
  return age == null ? null : Math.min(Number.MAX_SAFE_INTEGER, age + Math.max(0, nowMs - position.receivedAtMs));
}

export function gameObservation(position: KnownPosition, playerId: string, nowMs: number): Observation | null {
  const age = position.report.reportedAgeMs;
  const currentAge = positionAgeMs(position, nowMs);
  if (!position.sharing || age == null || currentAge === null || currentAge >= locationInactivityMs) return null;
  const expiresAtMs = Math.min(Number.MAX_SAFE_INTEGER, position.receivedAtMs + locationInactivityMs - age);
  if (expiresAtMs <= nowMs) return null;
  return { ...position.report, playerId, capturedAtMs: Math.max(0, position.receivedAtMs - age), expiresAtMs };
}
