import { locationInactivityMs } from "../shared/protocol";
import rockIcon from "@tabler/icons/outline/hand-grab.svg?url";
import paperIcon from "@tabler/icons/outline/hand-stop.svg?url";
import scissorsIcon from "@tabler/icons/outline/hand-two-fingers.svg?url";
import type { CompassState } from "./compass";
import type { EngineEvent, Faction, HostCommand, PlayerSnapshot } from "../shared/protocol";

export type MatchActions = {
  pause(): void; beginResume(): void; cancelResume(): void; end(): void; leave(): void;
  configure(command: Extract<HostCommand, { type: "configure" }>): void;
  setFaction(playerId: string, faction: Faction): void;
};
export type HudState = {
  events?: EngineEvent[];
  interruption?: string | null;
  locationLabel: string | null;
  sharing: boolean;
  shareLocation(): void;
  stopSharing(): void;
  compass: CompassState;
  toggleCompass(): void;
};
export type ConversionEffect = {
  eventSeq: number; faction: Faction; playerId: string; label: string; startedAt: number;
  x: number | null; y: number | null;
};
export type FailedConversionEffect = {
  key: string; playerId: string; faction: Faction; x: number; y: number; startedAt: number;
};
export type GameMotion = {
  reveal: ConversionEffect | null;
  conversions: ConversionEffect[];
  failures: FailedConversionEffect[];
};
export const motionTiming = { stampAt: 480, holdAt: 640, exitAt: 3640, revealEnd: 3960, resultEnd: 4000, failureEnd: 650 };
export const names = { rock: "Rock", paper: "Paper", scissors: "Scissors" };
export const targets: Record<Faction, Faction> = { rock: "scissors", paper: "rock", scissors: "paper" };
export const radarRoles = {
  target: { label: "Target", symbol: "T" }, threat: { label: "Threat", symbol: "!" },
  same: { label: "Same faction", symbol: "=" }, you: { label: "You", symbol: "" },
  player: { label: "Player", symbol: "" },
};
export const symbols = {
  rock: rockIcon,
  paper: paperIcon,
  scissors: scissorsIcon,
};
export function clock(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function isCurrentPosition(position: { ageMs: number | null; active: boolean } | null, elapsedMs: number): boolean {
  return !!position?.active && position.ageMs !== null && position.ageMs + Math.max(0, elapsedMs) < locationInactivityMs;
}
export function updated(ageMs: number | null, elapsedMs: number): string {
  if (ageMs === null) return "Update time unknown";
  const seconds = Math.floor((ageMs + Math.max(0, elapsedMs)) / 1000);
  return seconds < 1 ? "Updated just now" : seconds < 60 ? `Updated ${seconds} s ago` :
    `Updated ${Math.floor(seconds / 60)} min ago`;
}
export function relationship(snapshot: PlayerSnapshot, faction: Faction, playerId?: string) {
  return playerId === snapshot.ownPlayerId ? "you" : !snapshot.ownFaction ? "player" :
    faction === snapshot.ownFaction ? "same" : faction === targets[snapshot.ownFaction] ? "target" : "threat";
}
export function attackFor(snapshot: PlayerSnapshot, playerId: string) {
  return snapshot.outgoing?.targetId === playerId ? snapshot.outgoing :
    snapshot.incoming.find(attack => attack.attackerId === playerId);
}
export function combatLabel(snapshot: PlayerSnapshot, player: PlayerSnapshot["roster"][number]) {
  return snapshot.outgoing?.targetId === player.id ? `You are influencing ${player.label}` : `${player.label} is influencing you`;
}
export function activitySnapshot(snapshot: PlayerSnapshot, live: boolean, elapsedMs: number): PlayerSnapshot {
  const quality = (id: string) => snapshot.radar?.reference?.playerId === id ? snapshot.radar.reference :
    snapshot.radar?.players.find(p => p.playerId === id)?.position ?? null;
  const eligible = (attack: NonNullable<PlayerSnapshot["outgoing"]>) => live && snapshot.phase === "running" &&
    isCurrentPosition(quality(attack.attackerId), elapsedMs) && isCurrentPosition(quality(attack.targetId), elapsedMs);
  return { ...snapshot, outgoing: snapshot.outgoing && eligible(snapshot.outgoing) ? snapshot.outgoing : null,
    incoming: snapshot.incoming.filter(eligible) };
}
export function radarLayout(snapshot: PlayerSnapshot) {
  const players = snapshot.radar?.players ?? [];
  const scale = Math.ceil(Math.max(25, snapshot.parameters?.entryRadiusM ?? 0,
    ...players.map(p => p.position?.distanceM ?? 0)) / 25) * 25;
  const placed = [{ x: 160, y: 160 }];
  const markers = players.flatMap((p, index) => {
    const player = snapshot.roster.find(player => player.id === p.playerId);
    if (!p.position || !player) return [];
    const angle = p.position.bearingDegrees * Math.PI / 180;
    const radius = 120 * p.position.distanceM / scale;
    const x = 160 + Math.sin(angle) * radius, y = 160 - Math.cos(angle) * radius;
    let markerX = x, markerY = y;
    for (let attempt = 0; attempt < 32 && placed.some(p => Math.hypot(p.x - markerX, p.y - markerY) < 56); attempt++) {
      const angle = attempt * Math.PI / 4, offset = 56 * (1 + Math.floor(attempt / 8));
      markerX = Math.max(40, Math.min(280, x + Math.cos(angle) * offset));
      markerY = Math.max(40, Math.min(280, y + Math.sin(angle) * offset));
      const radius = Math.hypot(markerX - 160, markerY - 160);
      if (radius > 120) {
        markerX = 160 + (markerX - 160) * 120 / radius;
        markerY = 160 + (markerY - 160) * 120 / radius;
      }
    }
    placed.push({ x: markerX, y: markerY });
    const attack = attackFor(snapshot, p.playerId);
    const influence = !attack ? "none" : snapshot.outgoing?.targetId === p.playerId ? "outgoing" : "incoming";
    const linkAngle = Math.atan2(markerY - 160, markerX - 160);
    const dx = Math.cos(linkAngle), dy = Math.sin(linkAngle);
    const start = { x: 160 + dx * 11, y: 160 + dy * 11 };
    const end = { x: markerX - dx * 25, y: markerY - dy * 25 };
    const from = influence === "outgoing" ? start : end, to = influence === "outgoing" ? end : start;
    const direction = influence === "outgoing" ? 1 : -1;
    const backX = to.x - dx * direction * 8, backY = to.y - dy * direction * 8;
    return [{ player, position: p.position, index, x, y, markerX, markerY, attack, influence, from, to,
      arrow: `M${to.x} ${to.y}L${backX - dy * 4} ${backY + dx * 4}L${backX + dy * 4} ${backY - dx * 4}Z` }];
  });
  return { scale, markers };
}
export function describeEvent(event: EngineEvent, snapshot: PlayerSnapshot): string {
  const label = (id: string | null) => (id === event.attackerId ? event.attackerLabel : event.targetLabel) ??
    snapshot.roster.find(p => p.id === id)?.label ?? "Player";
  const name = event.faction ? names[event.faction] : "faction";
  switch (event.type) {
    case "conversion": return `${event.attackerId === snapshot.ownPlayerId ? "You" : label(event.attackerId)} converted ${event.targetId === snapshot.ownPlayerId ? "you" : label(event.targetId)} to ${name}.`;
    case "manual_faction_change": return `Host changed ${label(event.targetId)} from ${event.oldFaction ? names[event.oldFaction] : "a faction"} to ${name}.`;
    case "attack_started": return event.attackerId === snapshot.ownPlayerId ? `You are influencing ${label(event.targetId)}.` :
      `${label(event.attackerId)} is influencing ${event.targetId === snapshot.ownPlayerId ? "you" : label(event.targetId)}.`;
    case "attack_interrupted": {
      const participants = event.attackerId === snapshot.ownPlayerId ? `you were converting ${label(event.targetId)}` :
        `${label(event.attackerId)} was converting ${event.targetId === snapshot.ownPlayerId ? "you" : label(event.targetId)}`;
      return `Conversion stopped: ${participants}. ${event.reason ?? "Eligibility changed."}`;
    }
    case "lifecycle": return event.reason ?? "Match state changed.";
  }
}
