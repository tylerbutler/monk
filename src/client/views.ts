import { configureSchema, factionSchema, testDeviceLimitations, testPreset } from "../shared/protocol";
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
export function describeEvent(event: EngineEvent, snapshot: PlayerSnapshot): string {
  const label = (id: string | null) => snapshot.roster.find(p => p.id === id)?.label ?? "Player";
  const name = event.faction ? names[event.faction] : "faction";
  switch (event.type) {
    case "conversion": return `${label(event.attackerId)} converted ${label(event.targetId)} to ${name}.`;
    case "manual_faction_change": return `Host changed ${label(event.targetId)} from ${event.oldFaction ? names[event.oldFaction] : "a faction"} to ${name}.`;
    case "attack_started": return `Attack started: ${label(event.attackerId)} to ${label(event.targetId)}.`;
    case "attack_interrupted": return `Attack interrupted: ${event.reason ?? "Eligibility changed."}`;
    case "lifecycle": return event.reason ?? "Match state changed.";
  }
}
export function renderMatch(root: HTMLElement, snapshot: PlayerSnapshot, actions: MatchActions): void {
  root.replaceChildren();
  text(root, "p", snapshot.mode === "test" ? "Testing mode" : "Normal mode", "mode-label");
  text(root, "h2", snapshot.phase === "lobby" ? "Waiting room" : snapshot.phase === "paused" ? "Paused" :
    snapshot.phase === "ended" ? "Round ended" : "Round running");
  if (snapshot.resumeChecking) text(root, "p", "Freshness check. Gameplay and timers remain paused.", "state-line");
  if (snapshot.ownFaction) {
    const own = document.createElement("div"); own.className = "own-faction"; root.append(own);
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("aria-hidden", "true");
    icon.dataset.factionSymbol = snapshot.ownFaction;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", symbols[snapshot.ownFaction]); path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor"); path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round"); icon.append(path); own.append(icon);
    text(own, "strong", names[snapshot.ownFaction]); text(root, "p", `${names[snapshot.ownFaction]} converts ${targets[snapshot.ownFaction]}.`);
  } else text(root, "p", "Host view. Join as a player to participate.");
  if (snapshot.phase !== "lobby") {
    text(root, "p", `Round time: ${clock(snapshot.remainingMs)}`, "round-clock");
    if (snapshot.graceMs) text(root, "p", `Grace: ${clock(snapshot.graceMs)}. You cannot attack or be attacked.`);
    function attack(label: string, progress: NonNullable<PlayerSnapshot["outgoing"]>) {
      const row = document.createElement("label"); row.textContent = `${label}: ${snapshot.roster.find(p => p.id ===
        (label === "Outgoing attack" ? progress.targetId : progress.attackerId))?.label ?? "Player"}`;
      const bar = document.createElement("progress"); bar.max = 1; bar.value = progress.progress;
      row.append(bar); root.append(row);
    }
    if (snapshot.outgoing) attack("Outgoing attack", snapshot.outgoing);
    for (const incoming of snapshot.incoming) attack("Incoming attack", incoming);
    if (!snapshot.outgoing && !snapshot.incoming.length) text(root, "p", "No confirmed attack.");
    text(root, "p", `Fresh nearby players: Rock ${snapshot.nearby.rock}, Paper ${snapshot.nearby.paper}, Scissors ${snapshot.nearby.scissors}.`);
  }
  for (const reason of snapshot.qualityReasons) text(root, "p", reason, "warning");
  text(root, "p", snapshot.approved ? "Measured parameters approved for the stated device limits." : "Uncalibrated parameters. Test values are not an accuracy claim.", "calibration");
  if (snapshot.deviceLimitations) text(root, "p", `Device limits: ${snapshot.deviceLimitations}`);
  if (snapshot.phase === "lobby") {
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
      const rosterReady = snapshot.mode === "test" ? snapshot.roster.length >= 2 :
        snapshot.roster.length === 6 && (["rock", "paper", "scissors"] as const)
          .every(faction => snapshot.roster.filter(player => player.faction === faction).length === 2);
      start.disabled = !snapshot.parameters || !rosterReady || snapshot.mode === "normal" && !snapshot.approved;
      if (!rosterReady) text(controls, "p", snapshot.mode === "test" ? "Invite another player to start." :
        "Normal mode needs six players, two per faction.");
      text(controls, "p", "Starting requires browser location access and a fresh-location check.");
    }
    if (snapshot.phase === "running") control(controls, "Pause round", actions.pause, "pause");
    if (snapshot.phase === "paused") {
      if (snapshot.resumeChecking) control(controls, "Cancel freshness check", actions.cancelResume, "cancel-resume");
      else control(controls, "Check fresh locations and resume", actions.beginResume, "begin-resume");
    }
    if (snapshot.phase !== "lobby" && snapshot.phase !== "ended") control(controls, "End round", actions.end, "end", true);
    if (snapshot.phase === "lobby" || snapshot.mode === "test" && snapshot.phase !== "ended") {
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
      advanced.open = snapshot.mode === "normal" && !snapshot.parameters;
      text(advanced, "summary", "Advanced settings").id = "advanced-settings-toggle";
      const form = document.createElement("form"); form.className = "configuration"; advanced.append(form);
      const preset = snapshot.mode === "test" && !snapshot.parameters;
      const parameters = snapshot.parameters ?? (preset ? testPreset : null);
      text(form, "h3", snapshot.mode === "test" ? "Test round setup" : "Round settings");
      text(form, "p", preset ? "Save to use the uncalibrated starter values." :
        "Keep the saved values or adjust Advanced settings. Settings freeze during running and paused rounds.");
      const mode = input(form, "Testing mode (at least two active players)", "testingMode", "checkbox", "");
      mode.checked = snapshot.mode === "test";
      const grid = document.createElement("div"); grid.className = "form-grid"; form.append(grid);
      const fields: [keyof RuleParameters, string][] = [
        ["entryRadiusM", "Entry radius (m)"], ["retentionRadiusM", "Retention radius (m)"],
        ["maxAccuracyM", "Maximum uncertainty (m)"], ["freshnessMs", "Fix freshness (ms)"],
        ["dwellMs", "Continuous dwell (ms)"], ["graceMs", "Grace period (ms)"], ["roundDurationMs", "Round duration (minutes)"],
      ];
      for (const [name, label] of fields) {
        const value = name === "roundDurationMs" ? String((parameters?.roundDurationMs ?? 600000) / 60000) :
          parameters ? String(parameters[name]) : "";
        input(grid, label, name, "number", value);
      }
      input(form, "Device and measurement limitations", "deviceLimitations", "text",
        snapshot.deviceLimitations || (preset ? testDeviceLimitations : ""));
      const submit = document.createElement("button"); submit.type = "submit"; submit.dataset.action = "configure";
      submit.textContent = "Save round settings"; form.append(submit);
      const validation = text(form, "p", "", "error"); validation.hidden = true; validation.setAttribute("role", "alert");
      form.addEventListener("invalid", event => {
        if (event.target instanceof HTMLInputElement && advanced.contains(event.target)) advanced.open = true;
      }, true);
      form.addEventListener("submit", event => {
        event.preventDefault();
        const values = new FormData(form);
        const parameters = Object.fromEntries(fields.map(([name]) =>
          [name, Number(values.get(name)) * (name === "roundDurationMs" ? 60000 : 1)]));
        const parsed = configureSchema.safeParse({
          type: "configure", mode: mode.checked ? "test" : "normal", parameters, approved: false,
          deviceLimitations: String(values.get("deviceLimitations") ?? ""),
        });
        if (!parsed.success) {
          advanced.open = true;
          validation.hidden = false; validation.textContent = "Use positive finite values, whole milliseconds, and retention at least entry."; return;
        }
        validation.hidden = true; actions.configure(parsed.data);
      });
      if (snapshot.parameters && !snapshot.approved) {
        control(snapshot.mode === "test" ? advanced : controls, "Approve measured parameters and device limits", () => {
          if (snapshot.parameters) actions.configure({ type: "configure", mode: snapshot.mode,
            parameters: snapshot.parameters, approved: true, deviceLimitations: snapshot.deviceLimitations });
        }, "approve", true);
      }
    }
    if (snapshot.feedback?.conversions) {
      const f = snapshot.feedback;
      text(controls, "h3", "Visible conversion feedback");
      text(controls, "p", `${f.conversionsWithinOneSecond}/${f.conversions} conversions confirmed on both visible player interfaces within one second. ${f.conversionsFailed} failed; ${f.conversionsPending} pending; ${f.missing} missing acknowledgements.`);
      text(controls, "p", f.p95UpperMs === null ? "Display-delay upper-bound p95 is unavailable while acknowledgements are missing." :
        `Display-delay upper-bound p95: ${Math.ceil(f.p95UpperMs)} ms. This is not one-way network latency.`);
    }
  }
}
