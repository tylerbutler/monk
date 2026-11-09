import { parseClientMessage, parseServerMessage } from "../shared/protocol";
import type { ClientMessage, ConnectionHandlers, MatchConnection, ServerMessage, SessionCredentials } from "../shared/protocol";

export function connectMatch(credentials: SessionCredentials, handlers: ConnectionHandlers): MatchConnection {
  let socket: WebSocket, stopped = false, authenticated = false, needsSnapshot = true;
  let streamId: string | null = null, cursor = 0;
  let reconnect: ReturnType<typeof setTimeout> | null = null;
  let backoff = 1000;
  let clockProbe: { nonce: string; wallMs: number; monotonicMs: number } | null = null;
  let probeTimeout: ReturnType<typeof setTimeout> | null = null;
  let clockRefresh: ReturnType<typeof setTimeout> | null = null;
  let diagnosticRequested = false, trialActive = false;
  const pending = new Map<string, { message: Extract<ClientMessage, { type: "host_command" }>; attempts: number }>();
  function status(state: "connecting" | "connected" | "reconnecting" | "failed", reason: string | null) {
    if (!stopped) handlers.onStatus({ state, reason });
  }
  function rawSend(message: ClientMessage) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
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
    if (!diagnosticRequested || !trialActive || !authenticated || stopped) return;
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
  function requestProbe() {
    if (!authenticated || stopped || clockProbe) return;
    if (clockRefresh !== null) clearTimeout(clockRefresh);
    clockRefresh = null;
    clockProbe = { nonce: crypto.randomUUID(), wallMs: Date.now(), monotonicMs: performance.now() };
    status("connected", "Checking the phone clock.");
    rawSend({ version: 1, type: "clock_probe", nonce: clockProbe.nonce, clientSendMs: clockProbe.wallMs });
    probeTimeout = setTimeout(() => {
      clockProbe = null; probeTimeout = null;
      status("connected", "Diagnostic clock check timed out. Location sharing is still available.");
      scheduleProbe(5000);
    }, 5000);
  }
  function open() {
    if (stopped) return;
    authenticated = false; needsSnapshot = true; streamId = null; cursor = 0;
    status(backoff > 1000 ? "reconnecting" : "connecting", null);
    const url = new URL(`/api/matches/${credentials.matchCode}/socket`, window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(url);
    socket.addEventListener("open", () => rawSend({
      version: 1, type: "authenticate", hostToken: credentials.hostToken, playerToken: credentials.playerToken,
      supportsFactionHistory: true, supportsRoundResults: true,
    }));
    socket.addEventListener("message", event => {
      if (stopped) return;
      let raw: unknown;
      try { raw = JSON.parse(String(event.data)); } catch { status("failed", "Server sent invalid JSON. Reconnect."); return; }
      const parsed = parseServerMessage(raw);
      if (!parsed.ok) { status("failed", parsed.error); return; }
      const message = parsed.value;
      const changed = streamId !== message.streamId;
      if (changed) { streamId = message.streamId; cursor = 0; needsSnapshot = true; }
      if (message.type === "snapshot") {
        if (message.streamSeq <= cursor) return;
        cursor = message.streamSeq; needsSnapshot = false;
        updateTrial(message);
        if (message.startChecking) {
          for (const command of pending.values()) if (command.message.command.type === "start") command.attempts = 1;
        }
        handlers.onMessage(message);
        return;
      }
      if (message.type !== "authenticated" && (needsSnapshot || message.streamSeq !== cursor + 1)) {
        rawSend({ version: 1, type: "snapshot_request" });
        if (message.type === "error" && !authenticated) {
          handlers.onMessage(message); status("failed", message.reason);
        }
        return;
      }
      cursor = message.streamSeq;
      if (message.type === "authenticated") {
        authenticated = true; backoff = 1000; status("connected", null);
        for (const { message: command } of pending.values()) rawSend(command);
      }
      if (message.type === "clock_reply") {
        if (!clockProbe || message.nonce !== clockProbe.nonce || message.clientSendMs !== clockProbe.wallMs ||
          Math.abs((Date.now() - clockProbe.wallMs) - (performance.now() - clockProbe.monotonicMs)) > 100) {
          clearProbe();
          status("connected", "Diagnostic clock reply is invalid. Retry the measurement clock check.");
          scheduleProbe(5000); return;
        }
        rawSend({ version: 1, type: "clock_confirm", nonce: message.nonce, clientReceiveMs: Date.now() });
      }
      if (message.type === "clock_ready") {
        clearProbe(); status("connected", null);
        scheduleProbe(20000);
      }
      if (message.type === "update") {
        updateTrial(message);
        if (message.outcome) pending.delete(message.outcome.commandId);
        if (message.startChecking) {
          for (const command of pending.values()) if (command.message.command.type === "start") command.attempts = 1;
        }
      }
      if (message.type === "error") {
        if (message.commandId && message.code !== "storage_failed") pending.delete(message.commandId);
        if (message.code === "clock_invalid") {
          clearProbe();
          status("connected", `Diagnostic clock: ${message.reason}`);
          scheduleProbe(5000);
        }
        if ((message.code === "diagnostic_clock_unavailable" || message.code === "diagnostic_fix_invalid") &&
          diagnosticRequested && trialActive && !clockProbe && clockRefresh === null) {
          scheduleProbe(0);
        }
        if (message.code === "expired" || message.code === "unauthorized" || message.code === "auth_timeout") {
          status("failed", message.reason); handlers.onMessage(message); close(); return;
        }
      }
      handlers.onMessage(message);
    });
    socket.addEventListener("error", () => status("reconnecting", "Connection failed. Location collection is stopped."));
    socket.addEventListener("close", event => {
      authenticated = false;
      stopDiagnostics();
      if (stopped) return;
      if (event.code === 1008) { status("failed", "Session ended or credentials expired."); close(); return; }
      status("reconnecting", "Connection lost. Waiting to reconnect.");
      reconnect = setTimeout(open, backoff); backoff = Math.min(10000, backoff * 2);
    });
  }
  function close() {
    stopped = true;
    clearInterval(retryInterval);
    if (reconnect !== null) clearTimeout(reconnect);
    stopDiagnostics();
    pending.clear(); socket.close();
  }
  const retryInterval = setInterval(() => {
    if (!authenticated || stopped) return;
    for (const command of pending.values()) {
      if (command.attempts >= 5) { status("failed", "Command reply is missing. Reconnect to retry its existing ID."); continue; }
      command.attempts += 1; rawSend(command.message);
    }
  }, 1500);
  open();
  return {
    send(message) {
      const parsed = parseClientMessage(message);
      if (!parsed.ok) { status("failed", parsed.error); return; }
      if (message.type === "host_command") pending.set(message.commandId, { message, attempts: 1 });
      if (message.type === "clock_probe") { diagnosticRequested = true; requestProbe(); return; }
      if (message.type === "trial_end" || message.type === "leave" || message.type === "suspend" ||
        message.type === "trial_ready" && !message.consent) stopDiagnostics();
      if (!authenticated) {
        if (message.type !== "host_command") status("failed", "Connection is not ready. Location was not sent.");
        return;
      }
      rawSend(message);
    },
    close,
  };
}
