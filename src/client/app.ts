import { connectMatch } from "./connection";
import { requestLocationPermission, startLocation } from "./location";
import { startCompass } from "./compass";
import type { CompassState } from "./compass";
import { addTrialSample, exportTrialSummary, newTrialSummary } from "./trial";
import { describeEvent, names, symbols, targets } from "./views";
import { icons } from "./icons";
import wordmark from "../../brand/assets/wordmark.svg?url";
import pairedMark from "../../brand/assets/symbol-paired.svg?url";
import { destroyMatch, renderActivity, renderMatch, setRadarHeading } from "./match-view.svelte";
import { deviceSchema, gamePreset, isFactionChange, sessionCredentialsSchema } from "../shared/protocol";
import type { ConnectionStatus, EngineEvent, HostCommand, LocationStatus, MatchConnection, PlayerSnapshot, ServerMessage, SessionCredentials, TrialSample, TrialStatus, TrialSummary } from "../shared/protocol";

function addIcon(parent: HTMLElement, source: string, className = "ui-icon"): HTMLImageElement {
  const image = document.createElement("img");
  image.src = source; image.alt = ""; image.className = className; image.setAttribute("aria-hidden", "true");
  parent.prepend(image); return image;
}
function text(parent: HTMLElement, tag: string, value: string, className = "", icon?: string): HTMLElement {
  const node = document.createElement(tag); node.textContent = value; node.className = className;
  if (icon) addIcon(node, icon);
  parent.append(node); return node;
}
function eventLine(parent: HTMLElement, event: EngineEvent, snapshot: PlayerSnapshot): HTMLElement {
  const line = text(parent, "p", describeEvent(event, snapshot));
  line.dataset.eventSeq = String(event.eventSeq);
  if (event.faction) addIcon(line, symbols[event.faction], "faction-icon").dataset.faction = event.faction;
  return line;
}
function field(parent: HTMLElement, label: string, name: string, type = "text", value = ""): HTMLInputElement {
  const wrapper = document.createElement("label");
  wrapper.textContent = label;
  const input = document.createElement("input");
  input.type = type; input.name = name; input.id = name; input.value = value; input.dataset.retain = "";
  if (type === "number") { input.min = "0"; input.step = "any"; input.inputMode = "decimal"; }
  wrapper.append(input); parent.append(wrapper); return input;
}

function renderRules(parent: HTMLElement) {
  const section = document.createElement("section");
  section.id = "how-to-play"; section.className = "rules";
  section.setAttribute("aria-labelledby", "rules-heading"); parent.append(section);
  text(section, "h2", "How to play").id = "rules-heading";

  const cycle = document.createElement("ul"); cycle.className = "faction-cycle"; section.append(cycle);
  for (const faction of ["rock", "scissors", "paper"] as const) {
    const item = document.createElement("li"); item.dataset.faction = faction; cycle.append(item);
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("aria-hidden", "true");
    const image = document.createElementNS(icon.namespaceURI, "image");
    image.setAttribute("href", symbols[faction]); image.setAttribute("width", "24"); image.setAttribute("height", "24");
    icon.append(image); item.append(icon);
    const label = text(item, "div", "");
    text(label, "strong", names[faction]);
    text(label, "span", `converts ${names[targets[faction]]}`);
  }

  const steps = document.createElement("ol"); steps.className = "rules-steps"; section.append(steps);
  for (const [heading, description] of [
    ["Find your target", "Your faction decides who you can convert. Check the player list and radar for targets and threats."],
    ["Stay in range", "Stay near your target while the progress bar fills. Wait for the conversion to be confirmed."],
    ["Change sides. Keep playing.", "When someone converts you, join their faction and stay in the game. Your targets change too."],
  ]) {
    const item = document.createElement("li"); steps.append(item);
    text(item, "h3", heading); text(item, "p", description);
  }

  const setup = document.createElement("details"); setup.id = "rules-details"; setup.className = "rules-setup"; section.append(setup);
  text(setup, "summary", "Full rules and round settings");
  text(setup, "p", `Conversion starts automatically when both players share usable locations and the game confirms range. Stay in range for ${gamePreset.dwellMs / 1000} seconds by default. An interruption resets progress. Players in your own faction cannot convert you.`);
  text(setup, "p", "After conversion, a short grace period prevents anyone from converting you again. Your targets and threats change with your faction.");
  text(setup, "h3", "Before you start");
  text(setup, "p", `Create a room or join with an invite link or room code. The host can start with two players. A round lasts ${gamePreset.roundDurationMs / 60000} minutes by default, or until the host ends it. The host can change the settings before play.`);
  text(setup, "p", "Select Share location when you are ready to take part in conversions. Keep the app visible and the screen on. Radar positions are approximate; a nearby marker alone does not confirm a conversion.");
}

export function mountApp(root: HTMLElement): () => void {
  const game = document.createElement("div");
  game.className = "match-view";
  const history = document.createElement("details"); history.id = "faction-history";
  let credentials: SessionCredentials | null = null, connection: MatchConnection | null = null;
  let snapshot: PlayerSnapshot | null = null, trial: TrialStatus | null = null;
  let snapshotLive = false, snapshotReceivedAt = performance.now();
  let latest: TrialSample | null = null, summary: TrialSummary | null = null;
  let connectionStatus: ConnectionStatus = { state: "connecting", reason: null };
  let location: LocationStatus = { collecting: false, permission: "unknown", visible: true, wakeLock: "unsupported", reason: null };
  let consent = false, trialConsent = false, clockReady = false, disposed = false;
  let commandStatus = "", feedback: EngineEvent[] = [];
  let conversionNotices: EngineEvent[] = [];
  let factionHistory: EngineEvent[] = [], historyAvailable = false, historyDirty = true, interruption: string | null = null;
  const pendingCommands = new Map<string, HostCommand>();
  const pendingFeedback = new Set<number>(), acknowledged = new Set<number>();
  let feedbackFrame = false, audio: AudioContext | null = null;
  let stopLocation: (() => void) | null = null;
  let stopPermissionCheck: (() => void) | null = null, requestingPermission = false;
  let compass: CompassState = { enabled: false, headingDegrees: null, reason: null };
  let stopCompass: (() => void) | null = null, compassFramePending = false;
  let error = "";
  let errorField = "";
  let inviteStatus = "";
  let diagnosticStatus = "";
  const rawInvite = new URLSearchParams(window.location.search).get("room");
  const invitedCode = rawInvite?.trim().toUpperCase() ?? null;
  const validInvite = invitedCode !== null && /^[A-Z2-9]{8}$/.test(invitedCode);
  if (invitedCode !== null && !validInvite) error = "This invite link has an invalid room code. Enter a valid eight-character code.";
  const retained = new Map<string, { value: string; checked: boolean }>();
  const disclosures = new Map<string, boolean>();

  function showError(reason: string, fieldId = "") {
    error = reason; errorField = fieldId; render();
    if (fieldId) {
      const field = root.querySelector<HTMLElement>(`#${fieldId}`);
      field?.focus({ preventScroll: true });
      field?.scrollIntoView?.({ block: "center" });
    } else if (!credentials) root.querySelector(".error")?.scrollIntoView?.({ block: "nearest" });
  }
  function stopLiveUpdates() {
    snapshotLive = false;
  }
  function applyCompass() {
    if (disposed) return;
    setRadarHeading(game, compass.headingDegrees, compass);
  }
  function compassChanged(state: CompassState) {
    compass = state;
    if (!state.enabled) stopCompass = null;
    if (disposed || compassFramePending) return;
    compassFramePending = true;
    requestAnimationFrame(() => { compassFramePending = false; applyCompass(); });
  }
  function toggleCompass() {
    if (stopCompass) {
      const stop = stopCompass; stopCompass = null; stop(); applyCompass();
    } else {
      const stop = startCompass(compassChanged);
      if (compass.enabled) stopCompass = stop;
      else stop();
      applyCompass();
    }
  }
  function button(parent: HTMLElement, label: string, action: () => void | Promise<void>, name: string, className = "", icon?: string, busyLabel?: string) {
    const node = document.createElement("button");
    const caption = document.createTextNode(label);
    node.type = "button"; node.append(caption); node.dataset.action = name; node.className = className;
    node.id = `action-${name}`;
    if (icon) addIcon(node, icon);
    node.addEventListener("click", async () => {
      node.disabled = true;
      node.setAttribute("aria-busy", "true");
      if (busyLabel) caption.data = busyLabel;
      try { await action(); } catch (failure) { showError(failure instanceof Error ? failure.message : "Request failed. Try again."); }
      finally { node.disabled = false; node.removeAttribute("aria-busy"); caption.data = label; }
    });
    parent.append(node); return node;
  }
  function stopCollection() {
    const stop = stopLocation; stopLocation = null;
    if (!stop) return;
    if (snapshot) {
      if (snapshot.outgoing || snapshot.incoming.length) interruption = "Conversion stopped. Location sharing stopped.";
      const radar = snapshot.radar;
      snapshot = { ...snapshot, outgoing: null, incoming: [], radar: radar ? { ...radar,
        reference: radar.reference?.playerId === snapshot.ownPlayerId ? { ...radar.reference, active: false } : radar.reference,
        players: radar.players.map(p => p.playerId === snapshot?.ownPlayerId && p.position ?
          { ...p, position: { ...p.position, active: false } } : p),
      } : null };
    }
    stop();
    if (connectionStatus.state === "connected" && snapshot?.ownPlayerId && snapshot.phase !== "ended") {
      connection?.send({ version: 1, type: "suspend", reason: "Location sharing is stopped." });
    }
  }
  function cancelPermissionCheck() {
    stopPermissionCheck?.(); stopPermissionCheck = null;
    if (requestingPermission) location = { ...location, reason: "Location permission check canceled." };
    requestingPermission = false;
  }
  function requestTrialConsent() {
    if (requestingPermission) return;
    function agree() {
      trialConsent = true;
      connection?.send({ version: 1, type: "clock_probe", nonce: crypto.randomUUID(), clientSendMs: Date.now() });
      connection?.send({ version: 1, type: "trial_ready", consent: true });
      reconcileCollection();
    }
    if (consent && location.permission === "granted") { agree(); return; }
    cancelPermissionCheck();
    requestingPermission = true; error = "";
    location = { ...location, permission: "unknown", reason: "Requesting browser location access. Respond if a prompt appears." };
    render();
    const cancel = requestLocationPermission(result => {
      requestingPermission = false; stopPermissionCheck = null;
      location = { ...location, ...result };
      if (result.permission === "granted") {
        agree();
      } else error = result.reason ?? "Location access failed. Try again.";
      render();
    });
    stopPermissionCheck = requestingPermission ? cancel : null;
  }
  function reconcileCollection() {
    const needed = !!snapshot?.ownPlayerId && (consent || trialConsent && clockReady &&
      !!trial?.collecting && trial.readyIds.includes(snapshot.ownPlayerId)) && connectionStatus.state === "connected" &&
      document.visibilityState === "visible" && snapshot.phase !== "ended";
    if (!needed) { stopCollection(); return; }
    if (!stopLocation) {
      stopLocation = startLocation(fix => connection?.send({ version: 1, type: "position", report: fix }), status => {
      location = { ...status, permission: status.permission === "unknown" && location.permission === "granted" ? "granted" : status.permission };
      if (!status.collecting && status.reason && document.visibilityState === "visible") {
        consent = false; trialConsent = false; error = status.reason; stopCollection();
      }
      if (!disposed) render();
      });
      if (!location.collecting) { stopLocation(); stopLocation = null; }
    }
  }
  function receive(message: ServerMessage) {
    if (disposed) return;
    if (message.type === "authenticated") {
      for (const [commandId, command] of pendingCommands) connection?.send({ version: 1, type: "host_command", commandId, command });
    }
    if (message.type === "clock_ready") clockReady = true;
    if (message.type === "snapshot" || message.type === "update") {
      const previousTrial = trial;
      snapshot = message.snapshot; trial = message.trial;
      snapshotReceivedAt = performance.now(); snapshotLive = document.visibilityState === "visible";
      if (message.type === "snapshot" && message.factionHistory !== undefined) {
        factionHistory = message.factionHistory.filter(isFactionChange); historyAvailable = true; historyDirty = true;
      }
      if (snapshot.phase === "ended" || previousTrial && (!trial || previousTrial.referenceM !== trial.referenceM ||
        previousTrial.playerIds.some((id, index) => id !== trial?.playerIds[index]))) {
        cancelPermissionCheck(); trialConsent = false;
      }
      if (message.type === "update") {
        if (message.outcome) {
          pendingCommands.delete(message.outcome.commandId);
          commandStatus = message.outcome.reason;
          if (!message.outcome.accepted) error = message.outcome.reason;
        }
        for (const event of message.events) {
          if (!feedback.some(e => e.eventSeq === event.eventSeq)) feedback = [...feedback, event].slice(-6);
          if (isFactionChange(event) && !factionHistory.some(e => e.eventSeq === event.eventSeq)) {
            factionHistory.push(event); historyDirty = true;
          }
          if (snapshot.ownPlayerId && (event.attackerId === snapshot.ownPlayerId || event.targetId === snapshot.ownPlayerId)) {
            if (event.type === "attack_interrupted") interruption = describeEvent(event, snapshot);
            else if (event.type === "attack_started" || isFactionChange(event)) interruption = null;
          }
          if (event.type === "conversion" && (event.attackerId === snapshot.ownPlayerId || event.targetId === snapshot.ownPlayerId) &&
            !acknowledged.has(event.eventSeq)) {
            pendingFeedback.add(event.eventSeq);
            if (!conversionNotices.some(e => e.eventSeq === event.eventSeq)) conversionNotices = [...conversionNotices, event].slice(-6);
          }
        }
      }
    }
    if (message.type === "error") {
      if (message.code.startsWith("diagnostic_") || message.code === "clock_invalid") diagnosticStatus = message.reason;
      else error = message.reason;
      if (message.code === "expired") { cancelPermissionCheck(); consent = false; trialConsent = false; clockReady = false; stopCollection(); }
    }
    if (message.type === "trial_sample") {
      latest = message.sample;
      if (summary && trial?.collecting) summary = addTrialSample(summary, message.sample);
    }
    reconcileCollection(); render();
  }
  function connect(next: SessionCredentials) {
    if (credentials?.matchCode !== next.matchCode) {
      pendingCommands.clear(); commandStatus = ""; consent = false;
      factionHistory = []; historyAvailable = false; interruption = null;
    }
    cancelPermissionCheck(); stopCollection(); connection?.close();
    stopLiveUpdates();
    destroyMatch(game);
    credentials = next; snapshot = null; trial = null; trialConsent = false; clockReady = false; error = ""; diagnosticStatus = "";
    historyAvailable = false; historyDirty = true;
    try { sessionStorage.setItem("monk-session", JSON.stringify(next)); }
    catch { throw new Error("Session storage is unavailable. Allow storage to keep private credentials."); }
    connection = connectMatch(next, {
      onMessage: receive,
      onStatus(status) {
        connectionStatus = status;
        if (status.state === "connected" && status.reason) { clockReady = false; diagnosticStatus = status.reason; }
        if (status.state !== "connected") { clockReady = false; stopCollection(); }
        if (status.state !== "connected") stopLiveUpdates();
        reconcileCollection();
        if (!disposed) render();
      },
    });
    render();
  }
  function sendCommand(command: HostCommand) {
    const pending = command.type === "start" ? [...pendingCommands].find(([, value]) => value.type === "start") : undefined;
    const commandId = pending?.[0] ?? crypto.randomUUID();
    pendingCommands.set(commandId, command); commandStatus = "Waiting for the authority response.";
    connection?.send({ version: 1, type: "host_command", commandId, command });
    render();
  }
  function acknowledgeVisibleFeedback() {
    if (feedbackFrame || !pendingFeedback.size || document.visibilityState !== "visible") return;
    feedbackFrame = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      feedbackFrame = false;
      if (disposed || document.visibilityState !== "visible" || !root.isConnected) return;
      for (const eventSeq of pendingFeedback) {
        const notice = root.querySelector<HTMLElement>(`.conversion-notice [data-event-seq="${eventSeq}"]`);
        if (!notice) continue;
        const bounds = notice.getBoundingClientRect(), viewport = window.visualViewport;
        const clip = notice.parentElement?.getBoundingClientRect();
        const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
        if (!clip || bounds.left < clip.left || bounds.top < clip.top || bounds.right > clip.right || bounds.bottom > clip.bottom ||
          bounds.width <= 0 || bounds.height <= 0 || bounds.left < left || bounds.top < top ||
          bounds.right > left + (viewport?.width ?? window.innerWidth) ||
          bounds.bottom > top + (viewport?.height ?? window.innerHeight) ||
          getComputedStyle(notice).visibility === "hidden") continue;
        connection?.send({ version: 1, type: "feedback_seen", eventSeq });
        acknowledged.add(eventSeq); pendingFeedback.delete(eventSeq);
        if (typeof navigator.vibrate === "function") navigator.vibrate(60);
        if (audio?.state === "running") {
          const oscillator = audio.createOscillator(), gain = audio.createGain();
          oscillator.frequency.value = 600; gain.gain.value = .05;
          oscillator.connect(gain); gain.connect(audio.destination);
          oscillator.start(); oscillator.stop(audio.currentTime + .08);
        }
      }
    }));
  }
  async function request(path: string, body: object): Promise<SessionCredentials> {
    const response = await fetch(path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const raw: unknown = await response.json();
    if (!response.ok) {
      const failure = typeof raw === "object" && raw !== null && "error" in raw && typeof raw.error === "string" ? raw.error : "Match request failed. Try again.";
      throw new Error(failure);
    }
    const parsed = sessionCredentialsSchema.safeParse(raw);
    if (!parsed.success) throw new Error("Match credentials are invalid. Create or join again.");
    return parsed.data;
  }
  function leave() {
    stopCompass?.(); stopCompass = null;
    cancelPermissionCheck(); stopCollection(); stopLiveUpdates(); consent = false; trialConsent = false;
    connection?.send({ version: 1, type: "leave" });
    connection?.close(); connection = null; credentials = null; snapshot = null; trial = null;
    latest = null; summary = null; retained.clear(); disclosures.clear(); error = "";
    pendingCommands.clear(); pendingFeedback.clear(); acknowledged.clear(); feedback = [];
    conversionNotices = []; inviteStatus = ""; factionHistory = []; historyAvailable = false; interruption = null;
    history.replaceChildren(); history.open = false; historyDirty = true;
    destroyMatch(game);
    sessionStorage.removeItem("monk-session"); render();
  }
  function readDevices(): TrialSummary {
    const input = (name: string) => root.querySelector<HTMLInputElement>(`#${name}`)?.value.trim() ?? "";
    const devices = [0, 1].map(i => deviceSchema.safeParse({
      model: input(`device-${i}`), os: input(`os-${i}`),
      mode: root.querySelector<HTMLSelectElement>(`#mode-${i}`)?.value,
    }));
    const a = devices[0], b = devices[1], conditions = input("conditions");
    if (!a.success || !b.success || !conditions) throw new Error("Enter both phone models, iOS versions, modes, and test conditions before the trial.");
    return newTrialSummary({ devices: [a.data, b.data], conditions, candidates: snapshot?.parameters ? [snapshot.parameters] : [] });
  }
  function trialView(parent: HTMLElement) {
    const section = document.createElement("details"); section.className = "trial"; section.id = "location-trial";
    section.open = !!trial; parent.append(section);
    text(section, "summary", "Optional location measurement", "", icons.location).id = "location-trial-toggle";
    text(section, "p", "Both selected players must agree to measurements. This does not change ordinary sharing or block the game.");
    if (diagnosticStatus) text(section, "p", diagnosticStatus, "radar-note");
    const details = document.createElement("details"); details.id = "trial-devices";
    details.open = !summary; text(details, "summary", "Device pair and conditions", "", icons.settings).id = "trial-devices-toggle"; section.append(details);
    const devices = document.createElement("div"); devices.className = "form-grid"; details.append(devices);
    for (const i of [0, 1]) {
      field(devices, `Phone ${i + 1} model`, `device-${i}`, "text");
      field(devices, `Phone ${i + 1} iOS version`, `os-${i}`, "text");
      const label = document.createElement("label"); label.textContent = `Phone ${i + 1} mode`;
      const select = document.createElement("select"); select.id = `mode-${i}`; select.dataset.retain = "";
      for (const mode of ["Safari tab", "Installed PWA", "Other browser"]) { const option = document.createElement("option"); option.textContent = mode; select.append(option); }
      label.append(select); devices.append(label);
    }
    field(details, "Outdoor conditions (do not enter names or coordinates)", "conditions");
    if (snapshot?.canHost && !trial) {
      const form = document.createElement("div"); form.className = "form-grid"; section.append(form);
      for (const i of [0, 1]) {
        const label = document.createElement("label"); label.textContent = `Trial player ${i + 1}`;
        const select = document.createElement("select"); select.id = `pair-${i}`; select.dataset.retain = "";
        snapshot.roster.forEach((player, index) => {
          const option = document.createElement("option"); option.value = player.id; option.textContent = player.label;
          option.selected = index === i; select.append(option);
        });
        label.append(select); form.append(label);
      }
      field(form, "Marked reference separation (metres)", "referenceM", "number");
      button(section, "Request trial consent", () => {
        const next = readDevices();
        const a = root.querySelector<HTMLSelectElement>("#pair-0")?.value;
        const b = root.querySelector<HTMLSelectElement>("#pair-1")?.value;
        const rawReference = root.querySelector<HTMLInputElement>("#referenceM")?.value ?? "";
        const referenceM = rawReference === "" ? null : Number(rawReference);
        if (!a || !b || a === b || (referenceM !== null && (!Number.isFinite(referenceM) || referenceM < 0))) {
          throw new Error("Select two different joined players and a valid reference separation.");
        }
        if (summary?.sampleCount) {
          const prior = [summary.devices, summary.conditions, summary.candidates.map(c => c.parameters)];
          const requested = [next.devices, next.conditions, next.candidates.map(c => c.parameters)];
          if (JSON.stringify(prior) !== JSON.stringify(requested)) {
            throw new Error("Export, then discard the existing summary before changing devices, conditions, or parameter candidates.");
          }
          summary = { ...summary, runtime: next.runtime };
        } else summary = next;
        latest = null;
        connection?.send({ version: 1, type: "trial_begin", playerIds: [a, b], referenceM });
      }, "trial-begin");
    }
    if (trial) {
      text(section, "p", trial.collecting ? "Trial collecting. Keep both apps visible." : "Waiting for both players to agree.", "state-line");
      if (snapshot?.ownPlayerId && trial.playerIds.includes(snapshot.ownPlayerId) && !trial.readyIds.includes(snapshot.ownPlayerId)) {
        button(section, requestingPermission ? "Requesting location access..." : "Agree and collect location",
          requestTrialConsent, "trial-ready").disabled = requestingPermission;
        button(section, "Decline trial", () => {
          cancelPermissionCheck(); trialConsent = false;
          connection?.send({ version: 1, type: "trial_ready", consent: false });
          reconcileCollection(); render();
        }, "trial-decline", "secondary");
      }
      button(section, "Stop trial", () => {
        cancelPermissionCheck(); trialConsent = false;
        connection?.send({ version: 1, type: "trial_end" }); reconcileCollection(); render();
      }, "trial-end", "secondary");
      text(section, "p", trial.referenceM === null ? "No reference separation entered." : `Reference separation: ${trial.referenceM} m`);
    }
    if (latest) {
      const metrics = document.createElement("dl"); metrics.className = "measurements"; section.append(metrics);
      const metric = (label: string, value: string) => { text(metrics, "dt", label); text(metrics, "dd", value); };
      metric("Estimated distance", `${latest.distanceM.toFixed(1)} m`);
      metric("Reported uncertainty", latest.uncertaintiesM.map(v => `${v.toFixed(1)} m`).join(" / "));
      metric("Sample age", latest.agesMs.map(v => `${Math.round(v)} ms`).join(" / "));
      metric("Update gap", latest.updateGapsMs.map(v => `${v} ms`).join(" / "));
      metric("Capture-to-receipt upper bound", latest.delayBoundsMs.map(v => `${Math.ceil(v[1])} ms`).join(" / "));
      metric("Clock uncertainty", latest.clockUncertaintiesMs.map(v => `${v} ms`).join(" / "));
    }
    if (summary) {
      text(section, "p", `${summary.sampleCount} samples. Results are provisional and device-specific.`);
      button(section, "Export measurement summary", () => {
        if (!summary) return;
        const blob = new Blob([exportTrialSummary(summary)], { type: "application/json" });
        const url = URL.createObjectURL(blob), anchor = document.createElement("a");
        anchor.href = url; anchor.download = "monk-two-iphone-summary.json"; anchor.click(); URL.revokeObjectURL(url);
      }, "export-trial", "secondary");
      if (!trial) button(section, "Discard measurement summary", () => {
        summary = null; latest = null; render();
      }, "discard-trial", "secondary");
    }
  }
  function render() {
    if (disposed) return;
    const playing = snapshot?.phase === "running" || snapshot?.phase === "paused";
    if (!snapshot?.radar || snapshot.phase === "ended") { stopCompass?.(); stopCompass = null; }
    const active = document.activeElement;
    const focused = active instanceof HTMLElement ? active.id : "";
    const selection = active instanceof HTMLInputElement && active.selectionStart !== null ?
      { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection } : null;
    for (const input of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-retain]")) {
      retained.set(input.id, { value: input.value, checked: input instanceof HTMLInputElement && input.checked });
    }
    for (const details of root.querySelectorAll<HTMLDetailsElement>("details[id]")) {
      if (details.id === "room-invite" && details.dataset.phase !== (snapshot?.phase ?? "") ||
        details.id === "safe-play" && details.dataset.context !== (playing ? "game" : "setup")) disclosures.delete(details.id);
      else disclosures.set(details.id, details.open);
    }
    root.replaceChildren();
    root.classList.toggle("in-game", playing);
    root.classList.toggle("homepage", !credentials);
    const header = document.createElement("header"); header.className = "masthead"; root.append(header);
    const title = text(header, "h1", "");
    const logo = document.createElement("img");
    logo.src = wordmark; logo.alt = "Monk"; logo.width = 104; logo.height = 32; title.append(logo);
    if (!credentials) {
      const skip = document.createElement("a"); skip.href = "#play"; skip.className = "skip-to-play";
      skip.textContent = "Skip to play"; header.append(skip);
    }
    if (playing && credentials) text(header, "span", `Room ${credentials.matchCode}`, "room-code");
    if (snapshot && conversionNotices.length) {
      const notice = document.createElement("aside"); notice.className = "conversion-notice";
      notice.setAttribute("role", "status"); notice.setAttribute("aria-live", pendingFeedback.size ? "polite" : "off");
      notice.setAttribute("aria-label", "Conversion notification"); root.append(notice);
      const shown = conversionNotices.slice(-2);
      for (const event of [...shown].reverse()) {
        eventLine(notice, event, snapshot);
      }
      button(notice, "Dismiss notification", () => {
        const ids = new Set(shown.map(e => e.eventSeq));
        conversionNotices = conversionNotices.filter(e => !ids.has(e.eventSeq));
        for (const id of ids) pendingFeedback.delete(id);
        render();
      }, "dismiss-conversion", "secondary", icons.close);
    }
    if (error && credentials) { const alert = text(root, "p", error, "error"); alert.setAttribute("role", "alert"); }
    if (!credentials) {
      const entry = document.createElement("div"); entry.className = "entry-layout"; entry.dataset.invited = String(validInvite); root.append(entry);
      if (!validInvite) {
        const intro = document.createElement("div"); intro.className = "entry-intro"; entry.append(intro);
        const lead = text(intro, "h2", "Change sides.");
        lead.append(document.createElement("br"), document.createTextNode("Keep playing."));
        text(intro, "p", "An outdoor Rock, Paper, Scissors game for friends.");
        const mark = document.createElement("img");
        mark.src = pairedMark; mark.alt = ""; mark.width = 140; mark.height = 120; intro.append(mark);
      }
      const area = document.createElement("section"); area.id = "play"; area.tabIndex = -1;
      area.setAttribute("aria-labelledby", "play-heading"); entry.append(area);
      text(area, "h2", validInvite ? "Join your friends." : "Play with friends").id = "play-heading";
      if (validInvite) text(area, "p", `You are invited to room ${invitedCode}.`);
      const name = field(area, "Display name (optional)", "displayName"); name.maxLength = 80; name.autocomplete = "off";
      const create = () => button(area, "Create room", async () => {
        connect(await request("/api/matches", { label: name.value.trim() }));
      }, "create", validInvite ? "secondary" : "", icons.create, "Creating room...");
      if (!validInvite) create();
      if (error && errorField !== "matchCode") { const alert = text(area, "p", error, "error"); alert.setAttribute("role", "alert"); }
      const form = document.createElement("form"); form.className = "join-form"; area.append(form);
      const code = field(form, "Room code", "matchCode", "text", validInvite ? invitedCode : "");
      code.required = true; code.maxLength = 8; code.autocomplete = "off";
      code.autocapitalize = "characters"; code.spellcheck = false;
      if (validInvite && code.parentElement) code.parentElement.hidden = true;
      if (!validInvite) {
        text(form, "p", "Enter the eight-character code from your host.", "input-help").id = "room-code-hint";
        code.setAttribute("aria-describedby", "room-code-hint");
      }
      if (error && errorField === "matchCode") {
        const alert = text(form, "p", error, "error"); alert.id = "room-code-error"; alert.setAttribute("role", "alert");
        code.setAttribute("aria-invalid", "true");
        code.setAttribute("aria-describedby", "room-code-hint room-code-error");
      }
      const submit = document.createElement("button"); submit.type = "submit"; submit.id = "action-join"; form.append(submit);
      const caption = document.createTextNode("Join room"); submit.append(caption);
      addIcon(submit, icons.join);
      form.addEventListener("submit", async event => {
        event.preventDefault();
        const matchCode = code.value.trim().toUpperCase();
        if (!/^[A-Z2-9]{8}$/.test(matchCode)) {
          showError("Enter the eight-character room code.", "matchCode"); return;
        }
        submit.disabled = true; submit.setAttribute("aria-busy", "true"); caption.data = "Joining room...";
        try {
          connect(await request(`/api/matches/${matchCode}/join`, { label: name.value.trim() }));
        } catch (failure) { showError(failure instanceof Error ? failure.message : "Join failed. Try again."); }
        finally { submit.disabled = false; submit.removeAttribute("aria-busy"); caption.data = "Join room"; }
      });
      if (validInvite) create();
      text(area, "p", "Location sharing stays off until you choose Share location. Agree on a safe outdoor play area.", "entry-safety");
      renderRules(root);
    } else {
      const top = document.createElement("div"); top.className = "match-heading";
      if (!playing) root.append(top);
      const roomTools = document.createElement("details"); roomTools.id = "room-tools";
      const tools = playing ? roomTools : top;
      if (playing) { top.append(roomTools); text(roomTools, "summary", "Room & options", "", icons.settings).id = "room-tools-toggle"; }
      text(tools, "h2", `Room ${credentials.matchCode}`);
      if (snapshot?.phase !== "ended") {
        const invite = new URL("/", window.location.origin); invite.searchParams.set("room", credentials.matchCode);
        const invites = document.createElement("details"); invites.id = "room-invite"; invites.open = snapshot?.phase === "lobby";
        invites.dataset.phase = snapshot?.phase ?? "";
        tools.append(invites); text(invites, "summary", "Invite players", "", icons.invite).id = "room-invite-toggle";
        const link = document.createElement("a"); link.href = invite.href; link.textContent = invite.href;
        link.className = "invite-link"; link.dataset.inviteLink = ""; link.target = "_blank"; link.rel = "noopener";
        link.id = "room-invite-link";
        invites.append(link);
        button(invites, "Copy invite link", async () => {
          inviteStatus = "";
          if (!navigator.clipboard?.writeText) throw new Error("Copy is unavailable. Copy the invite link from its context menu.");
          await navigator.clipboard.writeText(invite.href);
          inviteStatus = "Link copied."; render();
        }, "copy-invite", "secondary", icons.copy);
        if (snapshot?.canHost && snapshot.phase === "lobby") {
          const start = button(invites, "Start game", () => sendCommand({ type: "start" }), "start", "", icons.play);
          start.disabled = snapshot.roster.length < 2;
          if (start.disabled) text(invites, "p", "Invite another player to start.");
        }
        if (inviteStatus) text(invites, "p", inviteStatus, "state-line").setAttribute("role", "status");
      }
      if (!snapshot) text(root, "p", "Connecting to the private match. Location is not collected.");
      if (snapshot) {
        if (snapshot.canHost && !snapshot.ownPlayerId && snapshot.phase !== "ended") {
          button(tools, "Join as a player on this phone", async () => {
            if (!credentials) return;
            const player = await request(`/api/matches/${credentials.matchCode}/join`, { hostToken: credentials.hostToken });
            connect({ ...player, hostToken: credentials.hostToken });
          }, "host-join", "", icons.join);
        }
        const section = document.createElement("section"); section.className = "gameplay"; root.append(section);
        const known = snapshot.radar?.reference?.playerId === snapshot.ownPlayerId ||
          snapshot.radar?.players.some(p => p.playerId === snapshot?.ownPlayerId && p.position);
        const locationLabel = snapshot.ownPlayerId && snapshot.phase !== "ended" ?
          consent ? location.collecting ? known && location.permission === "granted" ?
            "Location sharing is on" : "Waiting for your location" :
            "Sharing will resume when connected and visible." : "Location sharing is off" : null;
        section.append(game);
        renderMatch(game, snapshot, {
          pause: () => sendCommand({ type: "pause" }),
          beginResume: () => sendCommand({ type: "begin_resume" }), cancelResume: () => sendCommand({ type: "cancel_resume" }),
          end: () => sendCommand({ type: "end" }), configure: sendCommand,
          setFaction: (playerId, faction) => sendCommand({ type: "set_faction", playerId, faction }), leave,
        }, connectionStatus.state === "connected" && snapshotLive, Math.max(0, performance.now() - snapshotReceivedAt), {
          locationLabel, sharing: consent, compass, toggleCompass, interruption,
          shareLocation() { error = ""; consent = true; reconcileCollection(); render(); },
          stopSharing() { consent = false; trialConsent = false; cancelPermissionCheck(); stopCollection(); render(); },
        });
        applyCompass();
        if (commandStatus) { const notice = text(section, "p", commandStatus, "state-line"); notice.setAttribute("role", "status"); }
        for (const select of section.querySelectorAll<HTMLSelectElement>('[data-action="set-faction"]')) {
          select.disabled = [...pendingCommands.values()].some(c => c.type === "set_faction");
        }
        if (snapshot.ownPlayerId && typeof AudioContext !== "undefined" && !audio) {
          button(tools, "Enable sound cues", async () => {
            audio = new AudioContext();
            try { await audio.resume(); } catch { showError("Sound could not start. Visual feedback stays on."); }
            render();
          }, "enable-audio", "secondary", icons.sound);
        }
        game.querySelector("#location-trial")?.remove();
        if (snapshot.phase === "lobby" && snapshot.canHost) trialView(game.querySelector("#host-diagnostics") ?? game);
        else if (trial && snapshot.ownPlayerId && trial.playerIds.includes(snapshot.ownPlayerId)) trialView(root);
        if (feedback.length) {
          const events = document.createElement("details"); events.id = "match-feedback"; events.className = "feedback";
          events.setAttribute("aria-label", "Match feedback"); tools.append(events);
          text(events, "summary", "Match feedback", "", icons.feedback).id = "match-feedback-toggle";
          for (const event of [...feedback].reverse()) {
            eventLine(events, event, snapshot);
          }
        }
        root.append(history);
        if (historyDirty) {
          const scrollTop = history.querySelector("ol")?.scrollTop ?? 0;
          history.replaceChildren();
          text(history, "summary", `Faction changes (${factionHistory.length})`, "", icons.factions).id = "faction-history-toggle";
          text(history, "p", snapshot.canHost ? "All faction changes in this room. Times are local to this device." :
            "Only changes involving you. Times are local to this device.", "radar-note");
          if (!historyAvailable) text(history, "p", "Full history is unavailable. Reconnect to load saved changes.", "warning");
          else if (!factionHistory.length) text(history, "p", "No faction changes yet. Conversions and host changes will appear here.", "radar-note");
          const list = document.createElement("ol"); list.className = "faction-history-list"; history.append(list);
          const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
          for (const event of [...factionHistory].reverse()) {
            const item = document.createElement("li"); list.append(item);
            const date = new Date(event.atMs);
            text(item, "time", timeFormat.format(date)).setAttribute("datetime", date.toISOString());
            eventLine(item, event, snapshot);
            if (event.type === "conversion" && event.oldFaction && event.faction) {
              text(item, "span", `${names[event.oldFaction]} to ${names[event.faction]}`, "faction-history-transition");
            }
          }
          list.scrollTop = scrollTop; historyDirty = false;
        }
      }
      if (playing) root.append(top);
      if (connectionStatus.state === "failed") button(root, "Reconnect", () => { if (credentials) connect(credentials); }, "reconnect", "secondary", icons.refresh);
      button(tools, "Leave room", leave, "leave", "secondary", icons.leave);
      const status = document.createElement("section"); status.className = "status"; status.setAttribute("aria-label", "Device status");
      (connectionStatus.state === "connected" && !location.reason ? tools : root).append(status);
      text(status, "p", `Connection: ${connectionStatus.state}${connectionStatus.state !== "connected" && connectionStatus.reason ? ` - ${connectionStatus.reason}` : ""}`);
      if (location.reason && location.reason !== error) text(status, "p", location.reason, "warning");
    }
    const safety = document.createElement("footer"); root.append(safety);
    const help = document.createElement("details"); help.id = "safe-play"; help.open = !!credentials && !playing; safety.append(help);
    help.dataset.context = playing ? "game" : "setup";
    text(help, "summary", "Location and safe play", "", icons.safety).id = "safe-play-toggle";
    text(help, "p", "Agree on a bounded outdoor area and safe routes. No running or touching is needed. You can leave without a gameplay penalty. Keep this app visible and the screen on.");
    text(help, "p", "Share location uses browser permission. Players and the host see approximate direction and distance, not raw opponent coordinates. Last-known positions stay on radar, but influence stops after 30 seconds without a new position. Sharing stops when this app is hidden or disconnected. Locations stay only in temporary server memory, not match records or exports. Rooms and credentials expire within 24 hours.");
    for (const input of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-retain]")) {
      const value = retained.get(input.id);
      if (value) { input.value = value.value; if (input instanceof HTMLInputElement) input.checked = value.checked; }
    }
    for (const details of root.querySelectorAll<HTMLDetailsElement>("details[id]")) {
      if (details.id === "location-trial" && trial) details.open = true;
      else if (disclosures.has(details.id)) details.open = disclosures.get(details.id) === true;
    }
    if (focused) {
      const next = root.querySelector<HTMLElement>(`[id="${focused}"]`);
      next?.focus({ preventScroll: true });
      if (selection && next instanceof HTMLInputElement) next.setSelectionRange(selection.start, selection.end, selection.direction ?? undefined);
    }
    acknowledgeVisibleFeedback();
  }
  function visibility() {
    if (document.visibilityState !== "visible") {
      stopCollection(); stopLiveUpdates(); connection?.send({ version: 1, type: "suspend", reason: "App is hidden." }); render();
    } else if (connection) {
      connection.send({ version: 1, type: "snapshot_request" });
      reconcileCollection(); render();
    }
  }
  document.addEventListener("visibilitychange", visibility);
  const ageInterval = setInterval(() => {
    if (snapshot) renderActivity(game, snapshot, connectionStatus.state === "connected" && snapshotLive,
      Math.max(0, performance.now() - snapshotReceivedAt));
    applyCompass();
    acknowledgeVisibleFeedback();
  }, 250);
  try {
    const raw = sessionStorage.getItem("monk-session");
    if (raw) {
      const parsed = sessionCredentialsSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) throw new Error("Stored session is invalid. Leave and join again.");
      connect(parsed.data);
      if (validInvite && parsed.data.matchCode !== invitedCode) {
        error = `You are already in room ${parsed.data.matchCode}. Leave it before joining room ${invitedCode}.`;
      }
    }
  } catch { error = "Stored session could not be loaded. Clear this browser session or join again."; }
  render();
  return () => {
    disposed = true; cancelPermissionCheck(); stopCollection(); stopLiveUpdates(); connection?.close();
    stopCompass?.(); stopCompass = null;
    clearInterval(ageInterval);
    if (audio) void audio.close().catch(() => console.warn("monk", "audio_close_failed"));
    destroyMatch(game);
    document.removeEventListener("visibilitychange", visibility); root.replaceChildren();
  };
}
