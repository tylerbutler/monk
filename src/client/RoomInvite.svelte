<script lang="ts">
  import type { PlayerSnapshot } from "../shared/protocol";
  import InviteQr from "./InviteQr.svelte";
  import { icons } from "./icons";

  let { url, roomCode, phase, canHost, playerCount, start, reportError }: {
    url: string; roomCode: string; phase: PlayerSnapshot["phase"] | null;
    canHost: boolean; playerCount: number; start: () => void;
    reportError: (reason: string) => void;
  } = $props();
  let copying = $state(false), status = $state("");

  async function copyInvite() {
    copying = true; status = "";
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Copy is unavailable. Copy the invite link from its context menu.");
      await navigator.clipboard.writeText(url);
      status = "Link copied.";
    } catch (failure) {
      reportError(failure instanceof Error ? failure.message : "Request failed. Try again.");
    } finally { copying = false; }
  }
</script>

<details id="room-invite" open={phase === "lobby"} data-phase={phase ?? ""}>
  <summary id="room-invite-toggle"><img class="ui-icon" src={icons.invite} alt="" aria-hidden="true" />Invite players</summary>
  <a id="room-invite-link" class="invite-link" data-invite-link href={url} target="_blank" rel="noopener">{url}</a>
  <div class="invite-actions">
    <button type="button" id="action-copy-invite" data-action="copy-invite" class="secondary"
      disabled={copying} aria-busy={copying} onclick={copyInvite}><img class="ui-icon" src={icons.copy} alt="" aria-hidden="true" />Copy invite link</button>
    {#if canHost && phase === "lobby"}
      <button type="button" id="action-start" data-action="start" disabled={playerCount < 2} onclick={start}><img class="ui-icon" src={icons.play} alt="" aria-hidden="true" />Start game</button>
    {/if}
  </div>
  {#if canHost && phase === "lobby" && playerCount < 2}<p class="invite-help">Invite another player to start.</p>{/if}
  {#if status}<p class="state-line" role="status">{status}</p>{/if}
  <div id="invite-qr"><InviteQr {url} {roomCode} /></div>
</details>
