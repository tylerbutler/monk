import { flushSync, mount, unmount } from "svelte";
import Match from "./Match.svelte";
import type { CompassState } from "./compass";
import type { PlayerSnapshot } from "../shared/protocol";
import type { HudState, MatchActions } from "./views";

type ViewProps = {
  snapshot: PlayerSnapshot; actions: MatchActions; live: boolean; elapsedMs: number;
  hud: HudState | null; headingDegrees: number | null;
};
const views = new WeakMap<HTMLElement, { props: ViewProps; component: ReturnType<typeof mount> }>();

export function renderMatch(root: HTMLElement, snapshot: PlayerSnapshot, actions: MatchActions,
  live = true, elapsedMs = 0, hud: HudState | null = null): void {
  const view = views.get(root);
  if (view) {
    flushSync(() => Object.assign(view.props, { snapshot, actions, live, elapsedMs, hud }));
    return;
  }
  const props: ViewProps = $state({ snapshot, actions, live, elapsedMs, hud, headingDegrees: null });
  root.replaceChildren();
  root.dataset.matchRoot = "";
  const component = mount(Match, { target: root, props });
  views.set(root, { props, component });
  flushSync();
}
export function renderActivity(root: HTMLElement, snapshot: PlayerSnapshot, live: boolean, elapsedMs: number): void {
  const view = views.get(root);
  if (view) flushSync(() => Object.assign(view.props, { snapshot, live, elapsedMs }));
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
