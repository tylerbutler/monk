import { flushSync, mount, unmount } from "svelte";
import type { ComponentProps } from "svelte";
import AppShell from "./AppShell.svelte";
import TrialPanel from "./TrialPanel.svelte";
import { connectMatch } from "./connection";
import { requestLocationPermission, startLocation } from "./location";
import { startCompass } from "./compass";
import type { CompassState } from "./compass";
import { addTrialSample, exportTrialSummary, newTrialSummary } from "./trial";
import { describeEvent } from "./views";
import { destroyMatch, renderActivity, renderMatch, setRadarHeading, syncAwardDialog } from "./match-view.svelte";
import { deviceSchema, isFactionChange, sessionCredentialsSchema } from "../shared/protocol";
import type { ConnectionStatus, EngineEvent, HostCommand, LocationStatus, MatchConnection, PlayerSnapshot, ServerMessage, SessionCredentials, TrialSample, TrialStatus, TrialSummary } from "../shared/protocol";

export function mountApp(root: HTMLElement): () => void {
  root.replaceChildren();
  const game = document.createElement("div");
  game.className = "match-view";
  let shell: ReturnType<typeof mount> | null = null;
  let credentials: SessionCredentials | null = null, connection: MatchConnection | null = null;
  let snapshot: PlayerSnapshot | null = null, trial: TrialStatus | null = null;
  let snapshotLive = false, snapshotReceivedAt = performance.now();
  let latest: TrialSample | null = null, summary: TrialSummary | null = null;
  let connectionStatus: ConnectionStatus = { state: "connecting", reason: null };
  let location: LocationStatus = { collecting: false, permission: "unknown", visible: true, wakeLock: "unsupported", reason: null };
  let consent = false, trialConsent = false, clockReady = false, disposed = false;
  let commandStatus = "", feedback: EngineEvent[] = [];
  let conversionNotices: EngineEvent[] = [];
  let motionEvents: EngineEvent[] = [];
  let stateSource: "snapshot" | "update" | undefined;
  let factionHistory: EngineEvent[] = [], historyAvailable = false, interruption: string | null = null;
  const pendingCommands = new Map<string, HostCommand>();
  const pendingFeedback = new Set<number>(), acknowledged = new Set<number>();
  let feedbackFrame = false, audio: AudioContext | null = null;
  let stopLocation: (() => void) | null = null;
  let stopPermissionCheck: (() => void) | null = null, requestingPermission = false;
  let compass: CompassState = { enabled: false, headingDegrees: null, reason: null };
  let stopCompass: (() => void) | null = null, compassFramePending = false;
  let error = "";
  let errorField = "";
  let diagnosticStatus = "";
  const rawInvite = new URLSearchParams(window.location.search).get("room");
  const invitedCode = rawInvite?.trim().toUpperCase() ?? null;
  const validInvite = invitedCode !== null && /^[A-Z2-9]{8}$/.test(invitedCode);
  if (invitedCode !== null && !validInvite) error = "This invite link has an invalid room code. Enter a valid eight-character code.";
  const trialProps = $state<ComponentProps<typeof TrialPanel>>({
    snapshot: null, trial: null, latest: null, summary: null, diagnosticStatus: "", requestingPermission: false,
    begin: beginTrial, agree: requestTrialConsent,
    decline() {
      cancelPermissionCheck(); trialConsent = false;
      connection?.send({ version: 1, type: "trial_ready", consent: false });
      reconcileCollection(); render();
    },
    end() {
      cancelPermissionCheck(); trialConsent = false;
      connection?.send({ version: 1, type: "trial_end" }); reconcileCollection(); render();
    },
    exportSummary() {
      if (!summary) return;
      const blob = new Blob([exportTrialSummary(summary)], { type: "application/json" });
      const url = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = "monk-two-iphone-summary.json"; anchor.click(); URL.revokeObjectURL(url);
    },
    discard() { summary = null; latest = null; render(); },
    reportError: showError,
  });
  const shellProps = $state<ComponentProps<typeof AppShell>>({
    credentials: null, snapshot: null, connectionStatus, location, error: "", commandStatus: "",
    feedback: [], conversionNotices: [], feedbackPending: false, factionHistory: [], historyAvailable: false,
    audioAvailable: false, game, trial: trialProps,
    entry: {
      invitedCode: validInvite ? invitedCode : null, error: "", errorField: "",
      create: async (label: string) => { connect(await request("/api/matches", { label })); },
      join: async (code: string, label: string) => { connect(await request(`/api/matches/${code}/join`, { label })); },
      reportError: showError,
    },
    invitation: {
      url: "", roomCode: "", phase: null, canHost: false, playerCount: 0,
      start: () => sendCommand({ type: "start" }), reportError: showError,
    },
    async joinHost() {
      if (!credentials) return;
      const player = await request(`/api/matches/${credentials.matchCode}/join`, { hostToken: credentials.hostToken });
      connect({ ...player, hostToken: credentials.hostToken });
    },
    async enableAudio() {
      audio = new AudioContext();
      try { await audio.resume(); } catch { showError("Sound could not start. Visual feedback stays on."); }
      render();
    },
    leave, reconnect() { if (credentials) connect(credentials); },
    dismissConversion() {
      const ids = new Set(conversionNotices.slice(-2).map(event => event.eventSeq));
      conversionNotices = conversionNotices.filter(event => !ids.has(event.eventSeq));
      for (const id of ids) pendingFeedback.delete(id);
      render();
    },
    reportError: showError,
  });

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
      stateSource = message.type;
      motionEvents = message.type === "update" ? message.events : [];
      const previousTrial = trial;
      snapshot = message.snapshot; trial = message.trial;
      snapshotReceivedAt = performance.now(); snapshotLive = document.visibilityState === "visible";
      if (message.type === "snapshot" && message.factionHistory !== undefined) {
        factionHistory = message.factionHistory.filter(isFactionChange); historyAvailable = true;
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
            factionHistory = [...factionHistory, event];
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
      if (message.commandId && message.code !== "storage_failed") {
        pendingCommands.delete(message.commandId);
        commandStatus = message.reason;
      }
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
    const sameSession = credentials?.matchCode === next.matchCode &&
      credentials.hostToken === next.hostToken && credentials.playerToken === next.playerToken;
    if (credentials?.matchCode !== next.matchCode) {
      pendingCommands.clear(); commandStatus = ""; consent = false;
      factionHistory = []; historyAvailable = false; interruption = null;
    }
    cancelPermissionCheck(); stopCollection(); connection?.close();
    stopLiveUpdates();
    if (!sameSession) { destroyMatch(game); snapshot = null; trial = null; }
    credentials = next; trialConsent = false; clockReady = false; error = ""; diagnosticStatus = "";
    historyAvailable = false;
    try { sessionStorage.setItem("monk-session", JSON.stringify(next)); }
    catch { throw new Error("Session storage is unavailable. Allow storage to keep private credentials."); }
    connection = connectMatch(next, {
      onMessage: receive,
      onStatus(status) {
        connectionStatus = status;
        if (status.state === "connected" && status.reason) diagnosticStatus = status.reason;
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
        const takeover = root.querySelector(".conversion-takeover");
        const notice = (takeover ?? root.querySelector(".conversion-notice"))?.querySelector<HTMLElement>(`[data-event-seq="${eventSeq}"]`);
        if (!notice) continue;
        let visible = true;
        for (let ancestor: HTMLElement | null = notice; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (style.visibility === "hidden" || style.opacity === "0" || style.display === "none") { visible = false; break; }
        }
        const bounds = notice.getBoundingClientRect(), viewport = window.visualViewport;
        const clip = notice.parentElement?.getBoundingClientRect();
        const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
        if (!clip || bounds.left < clip.left || bounds.top < clip.top || bounds.right > clip.right || bounds.bottom > clip.bottom ||
          bounds.width <= 0 || bounds.height <= 0 || bounds.left < left || bounds.top < top ||
          bounds.right > left + (viewport?.width ?? window.innerWidth) ||
          bounds.bottom > top + (viewport?.height ?? window.innerHeight) ||
          !visible) continue;
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
    latest = null; summary = null; error = "";
    pendingCommands.clear(); pendingFeedback.clear(); acknowledged.clear(); feedback = [];
    conversionNotices = []; factionHistory = []; historyAvailable = false; interruption = null;
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
  function beginTrial() {
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
  }
  function render() {
    if (disposed) return;
    const playing = snapshot?.phase === "running" || snapshot?.phase === "paused";
    if (!snapshot?.radar || snapshot.phase === "ended") { stopCompass?.(); stopCompass = null; }
    const active = document.activeElement;
    root.classList.toggle("in-game", playing);
    root.classList.toggle("homepage", !credentials);
    root.classList.toggle("room-shell", !!credentials && !playing);
    root.dataset.phase = snapshot?.phase ?? (credentials ? "connecting" : "entry");
    flushSync(() => {
      Object.assign(trialProps, { snapshot, trial, latest, summary, diagnosticStatus, requestingPermission });
      Object.assign(shellProps, { credentials, snapshot, connectionStatus, location, error, commandStatus,
        feedback, conversionNotices, feedbackPending: pendingFeedback.size > 0, factionHistory, historyAvailable,
        audioAvailable: !!snapshot?.ownPlayerId && typeof AudioContext !== "undefined" && !audio });
      Object.assign(shellProps.entry, { error, errorField });
      if (credentials) {
        const invite = new URL("/", window.location.origin); invite.searchParams.set("room", credentials.matchCode);
        Object.assign(shellProps.invitation, {
          url: invite.href, roomCode: credentials.matchCode, phase: snapshot?.phase ?? null,
          canHost: snapshot?.canHost ?? false, playerCount: snapshot?.roster.length ?? 0,
        });
      }
    });
    if (!shell) { shell = mount(AppShell, { target: root, props: shellProps }); flushSync(); }
    if (credentials && snapshot) {
      const known = snapshot.radar?.reference?.playerId === snapshot.ownPlayerId ||
        snapshot.radar?.players.some(p => p.playerId === snapshot?.ownPlayerId && p.position);
      const locationLabel = snapshot.ownPlayerId && snapshot.phase !== "ended" ?
        consent ? location.collecting ? known && location.permission === "granted" ?
          "Location sharing is on" : "Waiting for your location" :
          "Sharing will resume when connected and visible." : "Location sharing is off" : null;
      renderMatch(game, snapshot, {
        pause: () => sendCommand({ type: "pause" }),
        beginResume: () => sendCommand({ type: "begin_resume" }), cancelResume: () => sendCommand({ type: "cancel_resume" }),
        end: () => sendCommand({ type: "end" }), configure: sendCommand,
        setFaction: (playerId, faction) => sendCommand({ type: "set_faction", playerId, faction }), leave,
      }, connectionStatus.state === "connected" && snapshotLive, Math.max(0, performance.now() - snapshotReceivedAt), {
        locationLabel, sharing: consent, compass, toggleCompass, interruption, events: motionEvents, stateSource,
        reconnect() { if (credentials) connect(credentials); },
        shareLocation() { error = ""; consent = true; reconcileCollection(); render(); },
        stopSharing() { consent = false; trialConsent = false; cancelPermissionCheck(); stopCollection(); render(); },
      }, trialProps);
      motionEvents = [];
      applyCompass();
      for (const select of game.querySelectorAll<HTMLSelectElement>('[data-action="set-faction"]')) {
        select.disabled = [...pendingCommands.values()].some(c => c.type === "set_faction");
      }
    }
    syncAwardDialog(root);
    if (active instanceof HTMLElement && root.contains(active) && document.activeElement !== active && !root.querySelector("#award-ceremony")) {
      active.focus({ preventScroll: true });
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
    if (shell) { const component = shell; shell = null; flushSync(() => { void unmount(component); }); }
    document.removeEventListener("visibilitychange", visibility);
  };
}
