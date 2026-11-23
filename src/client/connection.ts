import { Socket } from "phoenix";
import type { Channel, Push } from "phoenix";
import { joinReplySchema, parseClientMessage, parseServerMessage } from "../shared/protocol";
import type { ClientMessage, ConnectionHandlers, MatchConnection, ServerMessage, SessionCredentials } from "../shared/protocol";

type CancellablePush = Push & { cancelTimeout(): void; cancelRefEvent(): void };

export function connectMatch(credentials: SessionCredentials, handlers: ConnectionHandlers): MatchConnection {
  const socket = new Socket(`/api/matches/${credentials.matchCode}/socket`, {
    transport: WebSocket, heartbeatIntervalMs: 25_000, timeout: 5000,
  });
  let channel: Channel, stopped = false, baseline = false, generation = 0, restarting = false;
  let streamId: string | null = null, cursor = 0;
  let snapshotRequest: object | null = null;
  let clockProbe: { nonce: string; wallMs: number; monotonicMs: number } | null = null;
  let probeTimeout: ReturnType<typeof setTimeout> | null = null;
  let clockRefresh: ReturnType<typeof setTimeout> | null = null;
  let diagnosticRequested = false, trialActive = false;
  const attempts = new Map<string, number>();
  const requests = new Map<string, object>();
  const unconfirmed = new Set<string>();
  const activePushes = new Set<CancellablePush>();

  function status(state: "connecting" | "connected" | "reconnecting" | "failed", reason: string | null = null) {
    if (!stopped) handlers.onStatus({ state, reason });
  }
  function ready() { return !stopped && baseline && socket.isConnected() && channel.state === "joined"; }
  function clearProbe() {
    clockProbe = null;
    if (probeTimeout !== null) clearTimeout(probeTimeout);
    probeTimeout = null;
  }
  function stopDiagnostics() {
    clearProbe();
    if (clockRefresh !== null) clearTimeout(clockRefresh);
    clockRefresh = null; diagnosticRequested = false; trialActive = false;
  }
  function scheduleProbe(delay: number) {
    if (clockRefresh !== null) clearTimeout(clockRefresh);
    clockRefresh = null;
    if (!diagnosticRequested || !trialActive || !ready()) return;
    clockRefresh = setTimeout(() => { clockRefresh = null; requestProbe(); }, delay);
  }
  function updateTrial(message: Extract<ServerMessage, { type: "snapshot" | "update" }>) {
    if (!message.trial || message.snapshot.phase !== "lobby") { stopDiagnostics(); return; }
    const active = message.trial.collecting && message.snapshot.ownPlayerId !== null &&
      message.trial.readyIds.includes(message.snapshot.ownPlayerId);
    const started = active && !trialActive;
    trialActive = active;
    if (!active) {
      if (clockRefresh !== null) clearTimeout(clockRefresh);
      clockRefresh = null;
    } else if (started && diagnosticRequested && !clockProbe) requestProbe();
  }
  function track(push: Push): Push {
    const request = push as CancellablePush;
    activePushes.add(request);
    for (const result of ["ok", "error", "timeout"] as const) push.receive(result, () => activePushes.delete(request));
    return push;
  }
  function cancelRequests() {
    // Phoenix 1.8 has no public per-push cancellation API.
    for (const push of activePushes) { push.cancelTimeout(); push.cancelRefEvent(); }
    activePushes.clear();
  }
  function invalidate() {
    generation += 1; baseline = false; snapshotRequest = null; requests.clear(); stopDiagnostics(); cancelRequests();
    status("reconnecting", "Connection lost. Location sharing is stopped.");
  }
  function close() {
    if (stopped) return;
    stopped = true; generation += 1; baseline = false;
    requests.clear(); attempts.clear(); unconfirmed.clear(); snapshotRequest = null; stopDiagnostics(); cancelRequests();
    channel.leave(); socket.disconnect();
  }
  function fail(reason: string) { status("failed", reason); close(); }
  function reconnect() {
    if (stopped || restarting) return;
    restarting = true; invalidate();
    socket.disconnect(() => {
      restarting = false;
      if (stopped) return;
      if (channel.state === "closed") createChannel();
      socket.connect();
    });
  }
  function becameReady() {
    if (stopped) return;
    baseline = true; snapshotRequest = null;
    status("connected"); handlers.onReady();
  }
  function accept(raw: unknown) {
    if (stopped || channel.state !== "joined" || !socket.isConnected()) return;
    if (raw && typeof raw === "object" && Object.keys(raw).length === 0) return;
    const parsed = parseServerMessage(raw);
    if (!parsed.ok) { fail(parsed.error); return; }
    const message = parsed.value;
    if (message.type === "error" && ["expired", "unauthorized", "auth_timeout"].includes(message.code)) {
      handlers.onMessage(message); fail(message.reason); return;
    }
    if (message.type === "snapshot") {
      if (message.streamId === streamId && message.streamSeq <= cursor) return;
      const recovering = !baseline;
      streamId = message.streamId; cursor = message.streamSeq;
      handlers.onMessage(message);
      if (recovering) becameReady();
      updateTrial(message);
      return;
    }
    if (message.streamId === streamId && message.streamSeq <= cursor) return;
    if (!baseline || message.streamId !== streamId || message.streamSeq !== cursor + 1) {
      requestSnapshot(); return;
    }
    cursor = message.streamSeq;
    if (message.type === "update") updateTrial(message);
    if (message.type === "update" && message.outcome) {
      requests.delete(message.outcome.commandId); attempts.delete(message.outcome.commandId); unconfirmed.delete(message.outcome.commandId);
    }
    if (message.type === "error" && message.commandId && message.code !== "storage_failed") {
      requests.delete(message.commandId); attempts.delete(message.commandId); unconfirmed.delete(message.commandId);
    }
    if (message.type === "clock_reply") {
      if (!clockProbe || message.nonce !== clockProbe.nonce || message.clientSendMs !== clockProbe.wallMs ||
        Math.abs((Date.now() - clockProbe.wallMs) - (performance.now() - clockProbe.monotonicMs)) > 100) {
        clearProbe(); status("connected", "Diagnostic clock reply is invalid. Retry the measurement clock check.");
        scheduleProbe(5000); return;
      }
      push({ version: 1, type: "clock_confirm", nonce: message.nonce, clientReceiveMs: Date.now() });
    }
    if (message.type === "clock_ready") { clearProbe(); status("connected"); scheduleProbe(20000); }
    if (message.type === "error" && message.code === "clock_invalid") {
      clearProbe(); status("connected", `Diagnostic clock: ${message.reason}`); scheduleProbe(5000);
    }
    if (message.type === "error" && (message.code === "diagnostic_clock_unavailable" || message.code === "diagnostic_fix_invalid") &&
      diagnosticRequested && trialActive && !clockProbe && clockRefresh === null) {
      scheduleProbe(0);
    }
    handlers.onMessage(message);
  }
  function requestSnapshot() {
    if (stopped || snapshotRequest || !socket.isConnected() || channel.state !== "joined") return;
    baseline = false;
    status("reconnecting", "Recovering private match state. Location sharing is stopped.");
    const ticket = {}, current = generation;
    snapshotRequest = ticket;
    const valid = () => !stopped && current === generation && snapshotRequest === ticket;
    track(channel.push("snapshot_request", { version: 1, type: "snapshot_request" }, 5000))
      .receive("ok", raw => {
        if (!valid()) return;
        const parsed = parseServerMessage(raw);
        if (!parsed.ok || parsed.value.type !== "snapshot") { reconnect(); return; }
        accept(parsed.value);
        if (snapshotRequest === ticket) reconnect();
      })
      .receive("error", () => { if (valid()) reconnect(); })
      .receive("timeout", () => { if (valid()) reconnect(); });
  }
  function command(message: Extract<ClientMessage, { type: "host_command" }>) {
    if (!ready() || requests.has(message.commandId)) return;
    const count = attempts.get(message.commandId) ?? 0;
    if (count >= 5) {
      if (!unconfirmed.has(message.commandId)) {
        unconfirmed.add(message.commandId); handlers.onCommandUnconfirmed(message.commandId);
      }
      return;
    }
    const ticket = {}, current = generation;
    attempts.set(message.commandId, count + 1); requests.set(message.commandId, ticket);
    const valid = () => !stopped && generation === current && requests.get(message.commandId) === ticket;
    const retry = () => {
      if (!valid()) return;
      requests.delete(message.commandId);
      if (ready()) command(message);
    };
    const response = (raw: unknown) => {
      if (!valid()) return;
      requests.delete(message.commandId);
      accept(raw);
      const parsed = parseServerMessage(raw);
      if (parsed.ok && parsed.value.type === "error" && parsed.value.code === "storage_failed" && ready()) command(message);
    };
    track(channel.push(message.type, message, 5000)).receive("ok", response).receive("error", response).receive("timeout", retry);
  }
  function push(message: ClientMessage) {
    if (!ready()) return;
    const current = generation;
    const response = (raw: unknown) => { if (!stopped && current === generation) accept(raw); };
    track(channel.push(message.type, message, 5000)).receive("ok", response).receive("error", response);
  }
  function requestProbe() {
    if (!ready() || clockProbe) return;
    if (clockRefresh !== null) clearTimeout(clockRefresh);
    clockRefresh = null;
    clockProbe = { nonce: crypto.randomUUID(), wallMs: Date.now(), monotonicMs: performance.now() };
    status("connected", "Checking the phone clock.");
    push({ version: 1, type: "clock_probe", nonce: clockProbe.nonce, clientSendMs: clockProbe.wallMs });
    probeTimeout = setTimeout(() => {
      clearProbe();
      if (ready()) status("connected", "Diagnostic clock check timed out. Location sharing is still available.");
      scheduleProbe(5000);
    }, 5000);
  }
  function createChannel() {
    const currentChannel = socket.channel(`match:${credentials.matchCode}`, {
      hostToken: credentials.hostToken, playerToken: credentials.playerToken,
    });
    channel = currentChannel;
    for (const event of ["snapshot", "update", "clock_reply", "clock_ready", "trial_sample", "error"]) {
      currentChannel.on(event, raw => { if (currentChannel === channel) accept(raw); });
    }
    currentChannel.onError(() => { if (!stopped && currentChannel === channel) invalidate(); });
    currentChannel.onClose(() => { if (!stopped && currentChannel === channel) reconnect(); });
    currentChannel.join(5000).receive("ok", raw => {
      if (stopped || currentChannel !== channel || !socket.isConnected()) return;
      const parsed = joinReplySchema.safeParse(raw);
      if (!parsed.success) { fail("Join response is invalid. Reconnect to this match."); return; }
      generation += 1; attempts.clear(); requests.clear(); unconfirmed.clear();
      streamId = parsed.data.state.streamId; cursor = parsed.data.state.streamSeq;
      updateTrial(parsed.data.state);
      handlers.onMessage(parsed.data.state); becameReady();
    }).receive("error", raw => {
      if (stopped || currentChannel !== channel) return;
      if (raw?.code === "unauthorized" || raw?.code === "expired") fail(raw.reason);
      else invalidate();
    }).receive("timeout", () => { if (!stopped && currentChannel === channel) invalidate(); });
  }
  socket.onClose(event => {
    if (stopped) return;
    if (event.code === 1008) { fail("Session ended or credentials expired."); return; }
    invalidate();
  });
  socket.onError(() => { if (!stopped) invalidate(); });
  status("connecting");
  createChannel(); socket.connect();
  return {
    send(message) {
      if (stopped) return;
      const parsed = parseClientMessage(message);
      if (!parsed.ok) { status("failed", parsed.error); return; }
      if (message.type === "trial_end" || message.type === "leave" || message.type === "suspend" ||
        message.type === "trial_ready" && !message.consent) stopDiagnostics();
      if (message.type === "host_command") {
        if (unconfirmed.delete(message.commandId)) attempts.delete(message.commandId);
        command(message);
      } else if (message.type === "snapshot_request") requestSnapshot();
      else if (message.type === "clock_probe") { diagnosticRequested = true; requestProbe(); }
      else push(message);
    },
    close,
  };
}
