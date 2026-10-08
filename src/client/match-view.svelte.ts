import { flushSync, mount, unmount } from "svelte";
import Match from "./Match.svelte";
import type { CompassState } from "./compass";
import type { EngineEvent, PlayerSnapshot } from "../shared/protocol";
import type { GameMotion, HudState, MatchActions } from "./views";
import { activitySnapshot, motionTiming, radarLayout } from "./views";

type ViewProps = {
  snapshot: PlayerSnapshot; actions: MatchActions; live: boolean; elapsedMs: number;
  hud: HudState | null; headingDegrees: number | null;
  motion: GameMotion;
};
type MotionView = { props: ViewProps; activity: PlayerSnapshot; lastEventSeq: number };
const views = new WeakMap<HTMLElement, MotionView & { component: ReturnType<typeof mount> }>();

function updateMotion(view: MotionView, snapshot: PlayerSnapshot, live: boolean, elapsedMs: number, events: EngineEvent[]) {
  const now = performance.now(), previous = view.activity;
  const activity = activitySnapshot(snapshot, live, elapsedMs);
  const fresh = events.filter(event => event.eventSeq > view.lastEventSeq);
  for (const event of fresh) view.lastEventSeq = Math.max(view.lastEventSeq, event.eventSeq);
  const old = view.props.motion;
  let reveal = old.reveal && now - old.reveal.startedAt < motionTiming.revealEnd &&
    snapshot.ownFaction === old.reveal.faction ? old.reveal : null;
  const conversions = old.conversions.filter(effect => now - effect.startedAt < motionTiming.resultEnd);
  const failures = old.failures.filter(effect => now - effect.startedAt < motionTiming.failureEnd);
  if (!live || snapshot.phase !== "running" || snapshot.matchId !== previous.matchId) {
    reveal = null; conversions.length = 0; failures.length = 0;
  } else {
    const layout = radarLayout(activity), oldLayout = radarLayout(previous);
    for (const event of fresh) {
      if (event.type !== "conversion" || !event.faction || !event.targetId) continue;
      const marker = layout.markers.find(m => m.player.id === event.targetId);
      const effect = { eventSeq: event.eventSeq, faction: event.faction, playerId: event.targetId,
        label: event.targetLabel ?? snapshot.roster.find(p => p.id === event.targetId)?.label ?? "Player",
        startedAt: now, x: marker?.markerX ?? null, y: marker?.markerY ?? null };
      if (event.targetId === snapshot.ownPlayerId && event.faction === snapshot.ownFaction) reveal = effect;
      if (event.attackerId === snapshot.ownPlayerId) conversions.push(effect);
    }
    const attacks = [activity.outgoing, ...activity.incoming].filter(attack => attack !== null);
    for (const attack of [previous.outgoing, ...previous.incoming]) {
      if (!attack || attacks.some(next => next.attackerId === attack.attackerId && next.targetId === attack.targetId)) continue;
      const changed = fresh.some(event => (event.type === "conversion" || event.type === "manual_faction_change") &&
        (event.targetId === attack.targetId || event.targetId === attack.attackerId));
      const factionChanged = [attack.targetId, attack.attackerId].some(id =>
        previous.roster.find(p => p.id === id)?.faction !== snapshot.roster.find(p => p.id === id)?.faction);
      if (changed || factionChanged) continue;
      const ownTarget = attack.targetId === snapshot.ownPlayerId;
      const marker = layout.markers.find(m => m.player.id === attack.targetId) ??
        oldLayout.markers.find(m => m.player.id === attack.targetId);
      const faction = previous.roster.find(p => p.id === attack.attackerId)?.faction;
      if (!faction || !ownTarget && !marker) continue;
      failures.push({ key: `${attack.attackerId}:${attack.targetId}:${now}`, playerId: attack.targetId,
        faction, x: ownTarget ? 160 : marker?.markerX ?? 160, y: ownTarget ? 160 : marker?.markerY ?? 160, startedAt: now });
    }
  }
  if (reveal !== old.reveal || conversions.length !== old.conversions.length || failures.length !== old.failures.length ||
    conversions.some((effect, index) => effect !== old.conversions[index]) ||
    failures.some((effect, index) => effect !== old.failures[index])) {
    view.props.motion = { reveal, conversions, failures };
  }
  view.activity = activity;
}

export function renderMatch(root: HTMLElement, snapshot: PlayerSnapshot, actions: MatchActions,
  live = true, elapsedMs = 0, hud: HudState | null = null): void {
  const view = views.get(root);
  if (view) {
    flushSync(() => {
      updateMotion(view, snapshot, live, elapsedMs, hud?.events ?? []);
      Object.assign(view.props, { snapshot, actions, live, elapsedMs, hud });
    });
    return;
  }
  const props: ViewProps = $state({ snapshot, actions, live, elapsedMs, hud, headingDegrees: null,
    motion: { reveal: null, conversions: [], failures: [] } });
  const motionView = { props, activity: activitySnapshot(snapshot, live, elapsedMs), lastEventSeq: -1 };
  updateMotion(motionView, snapshot, live, elapsedMs, hud?.events ?? []);
  root.replaceChildren();
  root.dataset.matchRoot = "";
  const component = mount(Match, { target: root, props });
  views.set(root, { ...motionView, component });
  flushSync();
}
export function renderActivity(root: HTMLElement, snapshot: PlayerSnapshot, live: boolean, elapsedMs: number): void {
  const view = views.get(root);
  if (view) flushSync(() => {
    updateMotion(view, snapshot, live, elapsedMs, []);
    Object.assign(view.props, { snapshot, live, elapsedMs });
  });
}
export function setRadarHeading(root: HTMLElement, headingDegrees: number | null, compass?: CompassState): void {
  const target = root.matches("[data-match-root]") ? root : root.querySelector<HTMLElement>("[data-match-root]");
  const view = target ? views.get(target) : undefined;
  if (!view) return;
  flushSync(() => {
    view.props.headingDegrees = headingDegrees;
    if (compass && view.props.hud) view.props.hud.compass = compass;
  });
}
export function destroyMatch(root: HTMLElement): void {
  const view = views.get(root);
  if (!view) return;
  flushSync(() => { void unmount(view.component); });
  views.delete(root);
  delete root.dataset.matchRoot;
}
