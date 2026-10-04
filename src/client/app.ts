import { connectMatch } from "./connection";
import { requestLocationPermission, startLocation } from "./location";
import { addTrialSample, exportTrialSummary, newTrialSummary } from "./trial";
import { describeEvent, renderMatch } from "./views";
import { deviceSchema, sessionCredentialsSchema } from "../shared/protocol";
import type { ConnectionStatus, EngineEvent, HostCommand, LocationStatus, MatchConnection, PlayerSnapshot, ServerMessage, SessionCredentials, TrialSample, TrialStatus, TrialSummary } from "../shared/protocol";

function text(parent: HTMLElement, tag: string, value: string, className = ""): HTMLElement {
  const node = document.createElement(tag); node.textContent = value; node.className = className; parent.append(node); return node;
}
function field(parent: HTMLElement, label: string, name: string, type = "text", value = ""): HTMLInputElement {
  const wrapper = document.createElement("label");
  wrapper.textContent = label;
  const input = document.createElement("input");
  input.type = type; input.name = name; input.id = name; input.value = value; input.dataset.retain = "";
  if (type === "number") { input.min = "0"; input.step = "any"; input.inputMode = "decimal"; }
  wrapper.append(input); parent.append(wrapper); return input;
}

export function mountApp(root: HTMLElement): () => void {
  let credentials: SessionCredentials | null = null, connection: MatchConnection | null = null;
  let snapshot: PlayerSnapshot | null = null, trial: TrialStatus | null = null;
  let latest: TrialSample | null = null, summary: TrialSummary | null = null;
  let connectionStatus: ConnectionStatus = { state: "connecting", reason: null };
  let location: LocationStatus = { collecting: false, permission: "unknown", visible: true, wakeLock: "unsupported", reason: null };
  let consent = false, clockReady = false, disposed = false;
  let startChecking = false, commandStatus = "", feedback: EngineEvent[] = [];
  let conversionNotices: EngineEvent[] = [];
  const pendingCommands = new Map<string, HostCommand>();
  const pendingFeedback = new Set<number>(), acknowledged = new Set<number>();
  let feedbackFrame = false, audio: AudioContext | null = null;
  let stopLocation: (() => void) | null = null;
  let stopPermissionCheck: (() => void) | null = null, requestingPermission = false;
  let error = "";
  let inviteStatus = "";
  const rawInvite = new URLSearchParams(window.location.search).get("room");
  const invitedCode = rawInvite?.trim().toUpperCase() ?? null;
  const validInvite = invitedCode !== null && /^[A-Z2-9]{8}$/.test(invitedCode);
  if (invitedCode !== null && !validInvite) error = "This invite link has an invalid room code. Enter a valid eight-character code.";
  const retained = new Map<string, { value: string; checked: boolean }>();
  const disclosures = new Map<string, boolean>();

  function showError(reason: string) { error = reason; render(); }
  function button(parent: HTMLElement, label: string, action: () => void | Promise<void>, name: string, className = "") {
    const node = document.createElement("button");
    node.type = "button"; node.textContent = label; node.dataset.action = name; node.className = className;
    node.addEventListener("click", async () => {
      node.disabled = true;
      try { await action(); } catch (failure) { showError(failure instanceof Error ? failure.message : "Request failed. Try again."); }
      finally { node.disabled = false; }
    });
    parent.append(node); return node;
  }
  function stopCollection() { const stop = stopLocation; stopLocation = null; stop?.(); }
  function cancelPermissionCheck() {
    stopPermissionCheck?.(); stopPermissionCheck = null;
    if (requestingPermission) location = { ...location, reason: "Location permission check canceled." };
    requestingPermission = false;
  }
  function requestLocationConsent(forTrial = false, onGranted?: () => void) {
    if (requestingPermission) return;
    cancelPermissionCheck(); consent = false; stopCollection();
    requestingPermission = true; error = "";
    location = { ...location, permission: "unknown", reason: "Requesting browser location access. Respond if a prompt appears." };
    render();
    const cancel = requestLocationPermission(result => {
      requestingPermission = false; stopPermissionCheck = null;
      location = { ...location, ...result };
      if (result.permission === "granted") {
        consent = true;
        if (forTrial) connection?.send({ version: 1, type: "trial_ready", consent: true });
        onGranted?.();
        reconcileCollection();
      } else error = result.reason ?? "Location access failed. Try again.";
      render();
    });
    stopPermissionCheck = requestingPermission ? cancel : null;
  }
  function reconcileCollection() {
    const needed = !!snapshot?.ownPlayerId && consent && clockReady && connectionStatus.state === "connected" &&
      document.visibilityState === "visible" && (snapshot.phase === "running" || snapshot.resumeChecking || startChecking ||
        !!trial?.collecting && trial.readyIds.includes(snapshot.ownPlayerId));
    if (!needed) { stopCollection(); return; }
    if (!stopLocation) stopLocation = startLocation(fix => connection?.send({ version: 1, type: "position", report: fix }), status => {
      location = { ...status, permission: status.permission === "unknown" && location.permission === "granted" ? "granted" : status.permission };
      if (status.permission === "denied") {
        consent = false; error = status.reason ?? "Location permission denied."; stopCollection();
      }
      if (status.reason?.includes("clock")) {
        clockReady = false;
        connection?.send({ version: 1, type: "suspend", reason: "Phone clock changed." });
        connection?.send({ version: 1, type: "clock_probe", nonce: crypto.randomUUID(), clientSendMs: Date.now() });
      }
      if (!disposed) render();
    });
  }
  function receive(message: ServerMessage) {
    if (disposed) return;
    if (message.type === "authenticated") {
      for (const [commandId, command] of pendingCommands) connection?.send({ version: 1, type: "host_command", commandId, command });
    }
    if (message.type === "clock_ready") clockReady = true;
    if (message.type === "snapshot" || message.type === "update") {
      const previousTrial = trial;
      snapshot = message.snapshot; trial = message.trial; startChecking = message.startChecking;
      if (snapshot.phase === "ended" || previousTrial && (!trial || previousTrial.referenceM !== trial.referenceM ||
        previousTrial.playerIds.some((id, index) => id !== trial?.playerIds[index]))) cancelPermissionCheck();
      if (message.type === "update") {
        if (message.outcome) {
          pendingCommands.delete(message.outcome.commandId);
          commandStatus = message.outcome.reason;
          if (!message.outcome.accepted) error = message.outcome.reason;
        }
        for (const event of message.events) {
          if (!feedback.some(e => e.eventSeq === event.eventSeq)) feedback = [...feedback, event].slice(-6);
          if (event.type === "conversion" && (event.attackerId === snapshot.ownPlayerId || event.targetId === snapshot.ownPlayerId) &&
            !acknowledged.has(event.eventSeq)) {
            pendingFeedback.add(event.eventSeq);
            if (!conversionNotices.some(e => e.eventSeq === event.eventSeq)) conversionNotices = [...conversionNotices, event].slice(-6);
          }
        }
      }
    }
    if (message.type === "error") {
      error = message.reason;
      if (message.code === "expired") { cancelPermissionCheck(); consent = false; clockReady = false; stopCollection(); }
    }
    if (message.type === "trial_sample") {
      latest = message.sample;
      if (summary && trial?.collecting) summary = addTrialSample(summary, message.sample);
    }
    reconcileCollection(); render();
  }
  function connect(next: SessionCredentials) {
    if (credentials?.matchCode !== next.matchCode) { pendingCommands.clear(); commandStatus = ""; }
    cancelPermissionCheck(); connection?.close(); stopCollection();
    credentials = next; snapshot = null; trial = null; clockReady = false; error = "";
    try { sessionStorage.setItem("monk-session", JSON.stringify(next)); }
    catch { throw new Error("Session storage is unavailable. Allow storage to keep private credentials."); }
    connection = connectMatch(next, {
      onMessage: receive,
      onStatus(status) {
        connectionStatus = status;
        if (status.state !== "connected" || status.reason) { clockReady = false; stopCollection(); }
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
    cancelPermissionCheck(); stopCollection(); consent = false;
    connection?.send({ version: 1, type: "leave" });
    connection?.close(); connection = null; credentials = null; snapshot = null; trial = null;
    latest = null; summary = null; retained.clear(); disclosures.clear(); error = "";
    pendingCommands.clear(); pendingFeedback.clear(); acknowledged.clear(); feedback = []; startChecking = false;
    conversionNotices = []; inviteStatus = "";
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
    text(section, "summary", "Two-iPhone location trial").id = "location-trial-toggle";
    text(section, "p", "Measure marked separations outdoors. Both selected players must agree before location starts. Diagnostic freshness is 5000 ms; it does not set gameplay values.");
    const details = document.createElement("details"); details.id = "trial-devices";
    details.open = !summary; text(details, "summary", "Device pair and conditions").id = "trial-devices-toggle"; section.append(details);
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
          () => requestLocationConsent(true), "trial-ready").disabled = requestingPermission;
        button(section, "Decline trial", () => {
          cancelPermissionCheck(); consent = false; stopCollection();
          connection?.send({ version: 1, type: "trial_ready", consent: false });
        }, "trial-decline", "secondary");
      }
      button(section, "Stop trial", () => { cancelPermissionCheck(); stopCollection(); connection?.send({ version: 1, type: "trial_end" }); }, "trial-end", "secondary");
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
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.id : "";
    for (const input of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-retain]")) {
      retained.set(input.id, { value: input.value, checked: input instanceof HTMLInputElement && input.checked });
    }
    for (const details of root.querySelectorAll<HTMLDetailsElement>("details[id]")) disclosures.set(details.id, details.open);
    root.replaceChildren();
    const header = document.createElement("header"); header.className = "masthead"; root.append(header);
    text(header, "h1", "Monk"); text(header, "span", "Outdoor playtest", "edition");
    if (snapshot && conversionNotices.length) {
      const notice = document.createElement("aside"); notice.className = "conversion-notice";
      notice.setAttribute("role", "status"); notice.setAttribute("aria-live", pendingFeedback.size ? "polite" : "off");
      notice.setAttribute("aria-label", "Conversion notification"); root.append(notice);
      const shown = conversionNotices.slice(-2);
      for (const event of [...shown].reverse()) {
        const line = text(notice, "p", describeEvent(event, snapshot)); line.dataset.eventSeq = String(event.eventSeq);
      }
      button(notice, "Dismiss notification", () => {
        const ids = new Set(shown.map(e => e.eventSeq));
        conversionNotices = conversionNotices.filter(e => !ids.has(e.eventSeq));
        for (const id of ids) pendingFeedback.delete(id);
        render();
      }, "dismiss-conversion", "secondary");
    }
    if (error) { const alert = text(root, "p", error, "error"); alert.setAttribute("role", "alert"); }
    if (!credentials) {
      text(root, "h2", "Play together. Change sides.");
      text(root, "p", "Rock converts Scissors. Paper converts Rock. Scissors converts Paper. Confirmed proximity changes your faction; you stay in the game.", "intro");
      const area = document.createElement("section"); root.append(area); text(area, "h3", "Play with friends");
      if (validInvite) text(area, "p", `You are invited to room ${invitedCode}.`);
      button(area, "Create room", async () => { connect(await request("/api/matches", {})); }, "create", validInvite ? "secondary" : "");
      const form = document.createElement("form"); form.className = "join-form"; area.append(form);
      const code = field(form, "Room code", "matchCode", "text", validInvite ? invitedCode : "");
      code.required = true; code.maxLength = 8; code.autocomplete = "off";
      if (validInvite && code.parentElement) code.parentElement.hidden = true;
      const submit = document.createElement("button"); submit.type = "submit"; submit.textContent = "Join room"; form.append(submit);
      form.addEventListener("submit", async event => {
        event.preventDefault(); submit.disabled = true;
        try {
          const matchCode = code.value.trim().toUpperCase();
          if (!/^[A-Z2-9]{8}$/.test(matchCode)) throw new Error("Enter the eight-character room code.");
          connect(await request(`/api/matches/${matchCode}/join`, {}));
        } catch (failure) { showError(failure instanceof Error ? failure.message : "Join failed. Try again."); }
        finally { submit.disabled = false; }
      });
    } else {
      const top = document.createElement("div"); top.className = "match-heading"; root.append(top);
      text(top, "h2", `Room ${credentials.matchCode}`);
      if (snapshot?.phase === "lobby") {
        const invite = new URL("/", window.location.origin); invite.searchParams.set("room", credentials.matchCode);
        text(top, "h3", "Invite players");
        const link = document.createElement("a"); link.href = invite.href; link.textContent = invite.href;
        link.className = "invite-link"; link.dataset.inviteLink = ""; link.target = "_blank"; link.rel = "noopener";
        top.append(link);
        button(top, "Copy invite link", async () => {
          inviteStatus = "";
          if (!navigator.clipboard?.writeText) throw new Error("Copy is unavailable. Copy the invite link from its context menu.");
          await navigator.clipboard.writeText(invite.href);
          inviteStatus = "Link copied."; render();
        }, "copy-invite", "secondary");
        if (inviteStatus) text(top, "p", inviteStatus, "state-line").setAttribute("role", "status");
      }
      if (!snapshot) text(root, "p", "Connecting to the private match. Location is not collected.");
      if (snapshot) {
        if (snapshot.canHost && !snapshot.ownPlayerId && snapshot.phase === "lobby") {
          button(top, "Join as a player on this phone", async () => {
            if (!credentials) return;
            const player = await request(`/api/matches/${credentials.matchCode}/join`, { hostToken: credentials.hostToken });
            connect({ ...player, hostToken: credentials.hostToken });
          }, "host-join");
        }
        const section = document.createElement("section"); root.append(section);
        renderMatch(section, snapshot, {
          start: () => {
            if (snapshot?.ownPlayerId && !consent) requestLocationConsent(false, () => sendCommand({ type: "start" }));
            else sendCommand({ type: "start" });
          }, pause: () => sendCommand({ type: "pause" }),
          beginResume: () => sendCommand({ type: "begin_resume" }), cancelResume: () => sendCommand({ type: "cancel_resume" }),
          end: () => sendCommand({ type: "end" }), configure: sendCommand,
          setFaction: (playerId, faction) => sendCommand({ type: "set_faction", playerId, faction }), leave,
        });
        const start = section.querySelector<HTMLButtonElement>('[data-action="start"]');
        if (start) {
          start.disabled ||= requestingPermission || startChecking;
          if (requestingPermission) start.textContent = "Requesting location access...";
          else if (startChecking) start.textContent = "Checking fresh locations...";
        }
        if (startChecking) {
          text(section, "p", "Freshness check before start. The round is not running. Consenting players must provide fresh fixes within 10 seconds.", "state-line");
          for (const node of section.querySelectorAll<HTMLButtonElement | HTMLInputElement>(".configuration input, .configuration button, [data-action='start']")) node.disabled = true;
        }
        if (commandStatus) { const notice = text(section, "p", commandStatus, "state-line"); notice.setAttribute("role", "status"); }
        for (const select of section.querySelectorAll<HTMLSelectElement>('[data-action="set-faction"]')) {
          select.disabled = [...pendingCommands.values()].some(c => c.type === "set_faction");
        }
        if (snapshot.ownPlayerId && !consent && snapshot.phase !== "ended" && !(snapshot.canHost && snapshot.phase === "lobby")) {
          button(section, requestingPermission ? "Requesting location access..." : "Allow location for this round",
            () => requestLocationConsent(), "round-consent").disabled = requestingPermission;
        }
        if (snapshot.ownPlayerId && typeof AudioContext !== "undefined" && !audio) {
          button(section, "Enable sound cues", async () => {
            audio = new AudioContext();
            try { await audio.resume(); } catch { showError("Sound could not start. Visual feedback stays on."); }
            render();
          }, "enable-audio", "secondary");
        }
        if (snapshot.phase !== "lobby") {
          text(section, "h3", "Players");
          const roster = document.createElement("ul"); roster.className = "roster"; section.append(roster);
          for (const p of snapshot.roster) text(roster, "li", `${p.label} - ${p.faction}${p.id === snapshot.ownPlayerId ? " (you)" : ""}`);
        }
        if (snapshot.phase === "lobby") trialView(root);
        if (feedback.length) {
          const events = document.createElement("section"); events.className = "feedback"; events.setAttribute("aria-label", "Match feedback"); root.append(events);
          text(events, "h3", "Match feedback");
          for (const event of [...feedback].reverse()) {
            const line = text(events, "p", describeEvent(event, snapshot));
            line.dataset.eventSeq = String(event.eventSeq);
          }
        }
      }
      if (connectionStatus.state === "failed") button(root, "Reconnect", () => { if (credentials) connect(credentials); }, "reconnect", "secondary");
      button(root, "Leave match", leave, "leave", "secondary");
      const status = document.createElement("section"); status.className = "status"; status.setAttribute("aria-label", "Device status"); root.append(status);
      text(status, "p", `Connection: ${connectionStatus.state}${connectionStatus.reason ? ` - ${connectionStatus.reason}` : ""}`);
      text(status, "p", `Location: ${location.collecting ? "collecting" : "stopped"}; permission ${location.permission}; screen wake lock ${location.wakeLock}.`);
      if (location.reason) text(status, "p", location.reason, "warning");
    }
    const safety = document.createElement("footer"); root.append(safety);
    text(safety, "h3", "Location and safe play");
    text(safety, "p", "Agree on a bounded outdoor area and safe routes. No running or touching is needed. You can leave without a gameplay penalty. Keep this app visible and the screen on.");
    text(safety, "p", "Allow location requests browser access and discards its permission-check fix. Location reports require a consenting trial, active round, or fresh start or resume check. Opponent coordinates are not shown. Locations are not retained in match records or exports. Matches and credentials expire within 24 hours.");
    for (const input of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-retain]")) {
      const value = retained.get(input.id);
      if (value) { input.value = value.value; if (input instanceof HTMLInputElement) input.checked = value.checked; }
    }
    for (const details of root.querySelectorAll<HTMLDetailsElement>("details[id]")) {
      if (details.id === "location-trial" && trial) details.open = true;
      else if (disclosures.has(details.id)) details.open = disclosures.get(details.id) === true;
    }
    if (focused) root.querySelector<HTMLElement>(`[id="${focused}"]`)?.focus({ preventScroll: true });
    acknowledgeVisibleFeedback();
  }
  function visibility() {
    if (document.visibilityState !== "visible") {
      stopCollection(); connection?.send({ version: 1, type: "suspend", reason: "App is hidden." });
    } else if (connection) {
      clockReady = false;
      connection.send({ version: 1, type: "snapshot_request" });
      connection.send({ version: 1, type: "clock_probe", nonce: crypto.randomUUID(), clientSendMs: Date.now() });
    }
  }
  document.addEventListener("visibilitychange", visibility);
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
    disposed = true; cancelPermissionCheck(); stopCollection(); connection?.close();
    if (audio) void audio.close().catch(() => console.warn("monk", "audio_close_failed"));
    document.removeEventListener("visibilitychange", visibility); root.replaceChildren();
  };
}
