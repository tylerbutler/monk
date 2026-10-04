import { configureSchema, factionSchema, gamePreset, locationInactivityMs } from "../shared/protocol";
import type { EngineEvent, Faction, HostCommand, PlayerSnapshot, RuleParameters } from "../shared/protocol";

export type MatchActions = {
  start(): void; pause(): void; beginResume(): void; cancelResume(): void; end(): void; leave(): void;
  configure(command: Extract<HostCommand, { type: "configure" }>): void;
  setFaction(playerId: string, faction: Faction): void;
};
const names = { rock: "Rock", paper: "Paper", scissors: "Scissors" };
const targets = { rock: "Scissors", paper: "Rock", scissors: "Paper" };
const symbols = {
  rock: "M5 4 16 2 22 10 19 21 7 22 2 13Z",
  paper: "M5 2H15L21 8V22H5ZM15 2V8H21M9 12H17M9 16H17",
  scissors: "M8 10 21 2M8 14 21 22M10 12 21 12M8 7a3 3 0 1 0-6 0a3 3 0 1 0 6 0M8 17a3 3 0 1 0-6 0a3 3 0 1 0 6 0",
};
function text(parent: HTMLElement, tag: string, value: string, className = "") {
  const node = document.createElement(tag); node.textContent = value; node.className = className; parent.append(node); return node;
}
function control(parent: HTMLElement, label: string, action: () => void, name: string, secondary = false) {
  const button = document.createElement("button"); button.type = "button"; button.textContent = label;
  button.id = `action-${name}`;
  button.dataset.action = name; button.className = secondary ? "secondary" : "";
  button.addEventListener("click", action); parent.append(button); return button;
}
function input(parent: HTMLElement, label: string, name: string, type: string, value: string) {
  const wrapper = document.createElement("label"); wrapper.textContent = label;
  const field = document.createElement("input"); field.type = type; field.name = name;
  field.id = name; field.dataset.retain = ""; field.value = value;
  field.required = type !== "checkbox"; field.min = type === "number" ? "0.001" : ""; field.step = "any";
  wrapper.append(field); parent.append(wrapper); return field;
}
function clock(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function svg<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attributes: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  parent.append(node); return node;
}
function factionIcon(parent: Element, faction: Faction) {
  const icon = svg(parent, "svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
  icon.dataset.factionSymbol = faction;
  svg(icon, "path", { d: symbols[faction], fill: "none", stroke: "currentColor", "stroke-width": "1.6",
    "stroke-linecap": "round", "stroke-linejoin": "round" });
  return icon;
}
export function isCurrentPosition(position: { ageMs: number | null; active: boolean } | null, elapsedMs: number): boolean {
  return !!position?.active && position.ageMs !== null && position.ageMs + Math.max(0, elapsedMs) < locationInactivityMs;
}
function updated(ageMs: number | null, elapsedMs: number): string {
  if (ageMs === null) return "Update time unknown";
  const seconds = Math.floor((ageMs + Math.max(0, elapsedMs)) / 1000);
  return seconds < 1 ? "Updated just now" : seconds < 60 ? `Updated ${seconds} s ago` :
    `Updated ${Math.floor(seconds / 60)} min ago`;
}
function renderRadar(root: HTMLElement, snapshot: PlayerSnapshot, live: boolean, elapsedMs: number) {
  const radar = snapshot.radar;
  if (!radar) return;
  const section = document.createElement("section"); section.className = "player-radar";
  section.setAttribute("aria-label", "Player radar"); root.append(section);
  text(section, "h3", "Player radar");
  text(section, "p", "North stays at the top. Find players by number, faction, and approximate distance.", "radar-note");
  if (!live) text(section, "p", "Offline or hidden. Showing last-known positions.", "state-line");
  const reference = radar.reference;
  const label = (id: string) => snapshot.roster.find(p => p.id === id)?.label ?? "Player";
  const layout = document.createElement("div"); layout.className = "radar-layout"; section.append(layout);
  if (reference) {
    const figure = document.createElement("figure"); layout.append(figure);
    const chart = svg(figure, "svg", { viewBox: "0 0 320 320", "aria-hidden": "true" });
    chart.dataset.radar = "";
    const scale = Math.ceil(Math.max(25, snapshot.parameters?.entryRadiusM ?? 0,
      ...radar.players.map(p => p.position?.distanceM ?? 0)) / 25) * 25;
    for (const radius of [60, 120]) svg(chart, "circle", { cx: "160", cy: "160", r: String(radius), class: "radar-ring" });
    svg(chart, "path", { d: "M160 40V280M40 160H280", class: "radar-axis" });
    if (snapshot.parameters) svg(chart, "circle", { cx: "160", cy: "160",
      r: String(120 * snapshot.parameters.entryRadiusM / scale), class: "radar-entry" });
    for (const [direction, x, y] of [["North", 160, 19], ["S", 160, 311], ["E", 307, 165], ["W", 13, 165]] as const) {
      svg(chart, "text", { x: String(x), y: String(y), "text-anchor": "middle", class: "radar-compass" }).textContent = direction;
    }
    const placed = [{ x: 160, y: 160 }];
    radar.players.forEach((p, index) => {
      const player = snapshot.roster.find(player => player.id === p.playerId);
      if (!p.position || !player) return;
      const angle = p.position.bearingDegrees * Math.PI / 180;
      const radius = 120 * p.position.distanceM / scale;
      const x = 160 + Math.sin(angle) * radius, y = 160 - Math.cos(angle) * radius;
      const influence = snapshot.outgoing?.targetId === p.playerId ? "outgoing" :
        snapshot.incoming.some(a => a.attackerId === p.playerId) ? "incoming" : "none";
      if (influence !== "none") svg(chart, "line", { x1: "160", y1: "160", x2: String(x), y2: String(y),
        class: `radar-link ${influence}` });
      let markerX = x, markerY = y;
      for (let attempt = 0; attempt < 32 && placed.some(p => Math.hypot(p.x - markerX, p.y - markerY) < 38); attempt++) {
        const angle = attempt * Math.PI / 4, offset = 38 * (1 + Math.floor(attempt / 8));
        markerX = Math.max(40, Math.min(280, x + Math.cos(angle) * offset));
        markerY = Math.max(40, Math.min(280, y + Math.sin(angle) * offset));
      }
      placed.push({ x: markerX, y: markerY });
      if (markerX !== x || markerY !== y) {
        svg(chart, "line", { x1: String(x), y1: String(y), x2: String(markerX), y2: String(markerY), class: "radar-leader" });
        svg(chart, "circle", { cx: String(x), cy: String(y), r: "3", class: "radar-estimate" });
      }
      const marker = svg(chart, "g", { transform: `translate(${markerX} ${markerY})`, "data-radar-player": p.playerId,
        "data-influence": influence, "data-faction": player.faction,
        "data-current": String(live && isCurrentPosition(p.position, elapsedMs)), class: "radar-marker" });
      svg(marker, "title").textContent = `${index + 1}. ${player.label} - ${names[player.faction]}`;
      svg(marker, "circle", { r: "16" });
      const icon = factionIcon(marker, player.faction);
      icon.setAttribute("x", "-11"); icon.setAttribute("y", "-11");
      icon.setAttribute("width", "22"); icon.setAttribute("height", "22");
      svg(marker, "text", { x: "20", y: "-14", class: "radar-number" }).textContent = String(index + 1);
    });
    svg(chart, "circle", { cx: "160", cy: "160", r: "7", class: "radar-center",
      "data-current": String(live && isCurrentPosition(reference, elapsedMs)) });
    svg(chart, "text", { x: "160", y: "186", "text-anchor": "middle", class: "radar-compass" })
      .textContent = reference.playerId === snapshot.ownPlayerId ? "You" : "Reference";
    text(figure, "figcaption", `Outer ring: ${scale} m. Dashed ring: entry radius. Offset markers link to their estimated positions.`, "radar-note");
  }
  const details = document.createElement("div"); layout.append(details);
  if (reference) {
    text(details, "p", reference.playerId === snapshot.ownPlayerId ? "Reference: you" : `Reference: ${label(reference.playerId)}`, "state-line");
    text(details, "p", `GPS uncertainty ${reference.accuracyM} m. ${updated(reference.ageMs, elapsedMs)}.`, "radar-note");
    if (reference.accuracyM > (snapshot.parameters?.maxAccuracyM ?? gamePreset.maxAccuracyM)) text(details, "p", "Location is approximate.", "radar-note");
    else if (!live || !isCurrentPosition(reference, elapsedMs)) text(details, "p", "Last-known position.", "radar-note");
  } else text(details, "p", "Waiting for location.", "radar-note");
  const list = document.createElement("ol"); list.className = "radar-players"; details.append(list);
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  for (const p of radar.players) {
    const player = snapshot.roster.find(player => player.id === p.playerId);
    if (!player) continue;
    const row = document.createElement("li"); row.dataset.playerId = p.playerId; list.append(row);
    text(row, "strong", `${player.label} - ${names[player.faction]}`);
    if (p.position) {
      text(row, "p", p.position.distanceM === 0 ? "Within about 5 m." :
        `about ${p.position.distanceM} m ${directions[p.position.bearingDegrees / 45]}`);
      text(row, "p", `GPS uncertainty ${p.position.accuracyM} m. ${updated(p.position.ageMs, elapsedMs)}.`, "radar-note");
      if (p.position.accuracyM > (snapshot.parameters?.maxAccuracyM ?? gamePreset.maxAccuracyM)) text(row, "p", "Location is approximate.", "radar-note");
      else if (!live || !isCurrentPosition(p.position, elapsedMs)) text(row, "p", "Last-known position.", "radar-note");
      if (snapshot.outgoing?.targetId === p.playerId) text(row, "p", "You are influencing this player.", "influence-label");
      if (snapshot.incoming.some(a => a.attackerId === p.playerId)) text(row, "p", "This player is influencing you.", "influence-label");
    } else text(row, "p", "Waiting for location.", "radar-note");
  }
}
export function describeEvent(event: EngineEvent, snapshot: PlayerSnapshot): string {
  const label = (id: string | null) => snapshot.roster.find(p => p.id === id)?.label ?? "Player";
  const name = event.faction ? names[event.faction] : "faction";
  switch (event.type) {
    case "conversion": return `${event.attackerId === snapshot.ownPlayerId ? "You" : label(event.attackerId)} converted ${event.targetId === snapshot.ownPlayerId ? "you" : label(event.targetId)} to ${name}.`;
    case "manual_faction_change": return `Host changed ${label(event.targetId)} from ${event.oldFaction ? names[event.oldFaction] : "a faction"} to ${name}.`;
    case "attack_started": return event.attackerId === snapshot.ownPlayerId ? `You are influencing ${label(event.targetId)}.` :
      `${label(event.attackerId)} is influencing ${event.targetId === snapshot.ownPlayerId ? "you" : label(event.targetId)}.`;
    case "attack_interrupted": return `${event.attackerId === snapshot.ownPlayerId ? `Influence on ${label(event.targetId)}` :
      `${label(event.attackerId)}'s influence on ${event.targetId === snapshot.ownPlayerId ? "you" : label(event.targetId)}`} stopped: ${event.reason ?? "Eligibility changed."}`;
    case "lifecycle": return event.reason ?? "Match state changed.";
  }
}
export function renderActivity(root: HTMLElement, snapshot: PlayerSnapshot, live: boolean, elapsedMs: number): void {
  root.replaceChildren();
  const quality = (id: string) => snapshot.radar?.reference?.playerId === id ? snapshot.radar.reference :
    snapshot.radar?.players.find(p => p.playerId === id)?.position ?? null;
  const eligible = (attack: NonNullable<PlayerSnapshot["outgoing"]>) => live && snapshot.phase === "running" &&
    isCurrentPosition(quality(attack.attackerId), elapsedMs) && isCurrentPosition(quality(attack.targetId), elapsedMs);
  snapshot = { ...snapshot, outgoing: snapshot.outgoing && eligible(snapshot.outgoing) ? snapshot.outgoing : null,
    incoming: snapshot.incoming.filter(eligible) };
  if (snapshot.phase !== "lobby") {
    function attack(progress: NonNullable<PlayerSnapshot["outgoing"]>, outgoing: boolean) {
      const name = snapshot.roster.find(p => p.id === (outgoing ? progress.targetId : progress.attackerId))?.label ?? "Player";
      const label = outgoing ? `Influencing ${name}` : `${name} is influencing you`;
      const row = document.createElement("label"); row.className = "influence"; row.textContent = `${label} - ${Math.round(progress.progress * 100)}%`;
      const bar = document.createElement("progress"); bar.max = 1; bar.value = progress.progress;
      bar.setAttribute("aria-label", label); row.append(bar); root.append(row);
    }
    if (live && snapshot.phase === "running") {
      if (snapshot.outgoing) attack(snapshot.outgoing, true);
      for (const incoming of snapshot.incoming) attack(incoming, false);
      if (!snapshot.outgoing && !snapshot.incoming.length) text(root, "p", "No confirmed influence.");
      if (snapshot.outgoing || snapshot.incoming.length) text(root, "p", "Influence must stay confirmed until the bar fills. Leaving range or losing location quality stops progress.", "radar-note");
    }
  }
  if (snapshot.phase !== "ended") renderRadar(root, snapshot, live, elapsedMs);
}
export function renderMatch(root: HTMLElement, snapshot: PlayerSnapshot, actions: MatchActions, live = true, elapsedMs = 0): void {
  root.replaceChildren();
  text(root, "h2", snapshot.phase === "lobby" ? "Waiting room" : snapshot.phase === "paused" ? "Paused" :
    snapshot.phase === "ended" ? "Round ended" : "Round running");
  if (snapshot.ownFaction) {
    const own = document.createElement("div"); own.className = "own-faction"; root.append(own);
    factionIcon(own, snapshot.ownFaction);
    text(own, "strong", names[snapshot.ownFaction]); text(root, "p", `${names[snapshot.ownFaction]} converts ${targets[snapshot.ownFaction]}.`);
  } else text(root, "p", "Host view. Join as a player to participate.");
  if (snapshot.phase !== "lobby") {
    text(root, "p", `Round time: ${clock(snapshot.remainingMs)}`, "round-clock");
    if (snapshot.graceMs) text(root, "p", `Grace: ${clock(snapshot.graceMs)}. You cannot attack or be attacked.`);
  }
  const activity = document.createElement("div"); activity.dataset.matchActivity = ""; root.append(activity);
  renderActivity(activity, snapshot, live, elapsedMs);
  {
    text(root, "h3", `Players (${snapshot.roster.length})`);
    const roster = document.createElement("ul"); roster.className = "roster"; root.append(roster);
    for (const player of snapshot.roster) text(roster, "li",
      `${player.label} - ${player.faction}${player.id === snapshot.ownPlayerId ? " (you)" : ""}`);
  }
  if (snapshot.canHost) {
    const controls = document.createElement("section"); controls.className = "host-controls"; root.append(controls);
    if (snapshot.phase !== "lobby") text(controls, "h3", "Host controls");
    if (snapshot.phase === "lobby") {
      const start = control(controls, "Start game", actions.start, "start");
      start.disabled = snapshot.roster.length < 2;
      if (start.disabled) text(controls, "p", "Invite another player to start.");
    }
    if (snapshot.phase === "running") control(controls, "Pause round", actions.pause, "pause");
    if (snapshot.phase === "paused") {
      control(controls, "Resume round", actions.beginResume, "begin-resume");
    }
    if (snapshot.phase !== "lobby" && snapshot.phase !== "ended") control(controls, "End round", actions.end, "end", true);
    if (snapshot.phase !== "ended") {
      const factions = document.createElement("details"); factions.id = "faction-controls"; controls.append(factions);
      text(factions, "summary", "Change player factions").id = "faction-controls-toggle";
      text(factions, "p", "A live faction change clears both attack roles and gives the player a grace period.");
      for (const player of snapshot.roster) {
        const label = document.createElement("label"); label.textContent = player.label;
        const select = document.createElement("select"); select.dataset.action = "set-faction";
        select.id = `faction-${player.id}`; select.setAttribute("aria-label", `Faction for ${player.label}`);
        for (const f of ["rock", "paper", "scissors"] as const) {
          const option = document.createElement("option"); option.value = f; option.textContent = names[f];
          option.selected = f === player.faction; option.disabled = f === player.faction; select.append(option);
        }
        select.addEventListener("change", () => {
          const parsed = factionSchema.safeParse(select.value);
          if (parsed.success && parsed.data !== player.faction) actions.setFaction(player.id, parsed.data);
        });
        label.append(select); factions.append(label);
      }
    }
    if (snapshot.phase === "lobby") {
      const advanced = document.createElement("details"); advanced.id = "advanced-settings"; controls.append(advanced);
      text(advanced, "summary", "Advanced settings").id = "advanced-settings-toggle";
      const form = document.createElement("form"); form.className = "configuration"; advanced.append(form);
      const parameters = snapshot.parameters ?? gamePreset;
      text(form, "h3", "Round settings");
      text(form, "p", "Settings stay fixed while the round is running or paused.");
      const grid = document.createElement("div"); grid.className = "form-grid"; form.append(grid);
      const fields: [keyof RuleParameters, string][] = [
        ["entryRadiusM", "Entry radius (m)"], ["retentionRadiusM", "Retention radius (m)"],
        ["maxAccuracyM", "Influence uncertainty limit (m)"],
        ["dwellMs", "Continuous dwell (ms)"], ["graceMs", "Grace period (ms)"], ["roundDurationMs", "Round duration (minutes)"],
      ];
      for (const [name, label] of fields) {
        const value = name === "roundDurationMs" ? String((parameters?.roundDurationMs ?? 600000) / 60000) :
          String(parameters[name]);
        input(grid, label, name, "number", value);
      }
      const submit = document.createElement("button"); submit.type = "submit"; submit.dataset.action = "configure";
      submit.textContent = "Save round settings"; form.append(submit);
      const validation = text(form, "p", "", "error"); validation.hidden = true; validation.setAttribute("role", "alert");
      form.addEventListener("invalid", event => {
        if (event.target instanceof HTMLInputElement && advanced.contains(event.target)) advanced.open = true;
      }, true);
      form.addEventListener("submit", event => {
        event.preventDefault();
        const values = new FormData(form);
        const parameters = { ...Object.fromEntries(fields.map(([name]) =>
          [name, Number(values.get(name)) * (name === "roundDurationMs" ? 60000 : 1)])), freshnessMs: locationInactivityMs };
        const parsed = configureSchema.safeParse({
          type: "configure", mode: "test", parameters, approved: false, deviceLimitations: "",
        });
        if (!parsed.success) {
          advanced.open = true;
          validation.hidden = false; validation.textContent = "Use positive finite values, whole milliseconds, and retention at least entry."; return;
        }
        validation.hidden = true; actions.configure(parsed.data);
      });
    }
    const diagnostics = document.createElement("details"); diagnostics.id = "host-diagnostics"; controls.append(diagnostics);
    text(diagnostics, "summary", "Host diagnostics").id = "host-diagnostics-toggle";
    if (snapshot.feedback?.conversions) {
      const f = snapshot.feedback;
      text(diagnostics, "h3", "Visible conversion feedback");
      text(diagnostics, "p", `${f.conversionsWithinOneSecond}/${f.conversions} conversions confirmed on both visible player interfaces within one second. ${f.conversionsFailed} failed; ${f.conversionsPending} pending; ${f.missing} missing acknowledgements.`);
      text(diagnostics, "p", f.p95UpperMs === null ? "Display-delay upper-bound p95 is unavailable while acknowledgements are missing." :
        `Display-delay upper-bound p95: ${Math.ceil(f.p95UpperMs)} ms. This is not one-way network latency.`);
    }
  }
}
