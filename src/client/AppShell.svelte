<script lang="ts">
  import type { ComponentProps } from "svelte";
  import type { ConnectionStatus, EngineEvent, LocationStatus, PlayerSnapshot, SessionCredentials } from "../shared/protocol";
  import Entry from "./Entry.svelte";
  import RoomInvite from "./RoomInvite.svelte";
  import TrialPanel from "./TrialPanel.svelte";
  import ShellButton from "./ShellButton.svelte";
  import { describeEvent, names, symbols } from "./views";
  import { icons } from "./icons";
  import wordmark from "../../brand/assets/wordmark.svg?url";

  let { credentials, snapshot, connectionStatus, location, error, commandStatus, feedback,
    conversionNotices, feedbackPending, factionHistory, historyAvailable, audioAvailable,
    entry, invitation, trial, game, joinHost, enableAudio, leave, reconnect, dismissConversion, reportError }: {
    credentials: SessionCredentials | null; snapshot: PlayerSnapshot | null;
    connectionStatus: ConnectionStatus; location: LocationStatus; error: string; commandStatus: string;
    feedback: EngineEvent[]; conversionNotices: EngineEvent[]; feedbackPending: boolean;
    factionHistory: EngineEvent[]; historyAvailable: boolean; audioAvailable: boolean;
    entry: ComponentProps<typeof Entry>; invitation: ComponentProps<typeof RoomInvite>; trial: ComponentProps<typeof TrialPanel>;
    game: HTMLElement; joinHost: () => Promise<void>; enableAudio: () => Promise<void>; leave: () => void;
    reconnect: () => void; dismissConversion: () => void; reportError: (reason: string) => void;
  } = $props();
  const playing = $derived(snapshot?.phase === "running" || snapshot?.phase === "paused");
  const statusInTools = $derived(connectionStatus.state === "connected" && !location.reason);
  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  function attachGame(node: HTMLElement) { node.prepend(game); }
  function contextDisclosure(node: HTMLDetailsElement, value: { context: boolean; open: boolean }) {
    let context = value.context;
    node.open = value.open;
    return { update(next: typeof value) {
      if (next.context !== context) { node.open = next.open; context = next.context; }
    } };
  }
</script>

{#snippet icon(source: string)}
  <img class="ui-icon" src={source} alt="" aria-hidden="true" />
{/snippet}

{#snippet eventLine(event: EngineEvent)}
  {#if snapshot}
    <p data-event-seq={event.eventSeq}>
      {#if event.faction}<img class="faction-icon" src={symbols[event.faction]} alt="" aria-hidden="true" data-faction={event.faction} />{/if}{describeEvent(event, snapshot)}
    </p>
  {/if}
{/snippet}

{#snippet status()}
  <section class="status" aria-label="Device status">
    <p>Connection: {connectionStatus.state}{connectionStatus.state !== "connected" && connectionStatus.reason ? ` - ${connectionStatus.reason}` : ""}</p>
    {#if location.reason && location.reason !== error}<p class="warning">{location.reason}</p>{/if}
  </section>
{/snippet}

<header class="masthead">
  <h1><img src={wordmark} alt="Monk" width="104" height="32" /></h1>
  {#if !credentials}<a href="#play" class="skip-to-play">Skip to play</a>{/if}
  {#if playing && credentials}<span class="room-code">Room {credentials.matchCode}</span>{/if}
</header>
{#if snapshot && conversionNotices.length}
  <aside class="conversion-notice" role="status" aria-live={feedbackPending ? "polite" : "off"} aria-label="Conversion notification">
    {#each conversionNotices.slice(-2).reverse() as event (event.eventSeq)}{@render eventLine(event)}{/each}
    <ShellButton label="Dismiss notification" action={dismissConversion} name="dismiss-conversion" class="secondary" icon={icons.close} {reportError} />
  </aside>
{/if}
{#if error && credentials}<p class="error" role="alert">{error}</p>{/if}
{#if !credentials}
  <div class="entry-view"><Entry {...entry} /></div>
{:else}
  {#each playing ? ["game", "tools"] : ["tools", "game"] as section (section)}
    {#if section === "tools"}
      <div class="match-heading">
        <details id="room-tools" use:contextDisclosure={{ context: playing, open: !playing }} class:setup={!playing}>
          <summary id="room-tools-toggle" hidden={!playing}>{@render icon(icons.settings)}Room &amp; options</summary>
          <h2>Room {credentials.matchCode}</h2>
          {#if snapshot?.phase !== "ended"}<div class="room-invitation"><RoomInvite {...invitation} /></div>{/if}
          {#if snapshot}
            {#if snapshot.canHost && !snapshot.ownPlayerId && snapshot.phase !== "ended"}
              <ShellButton label="Join as a player on this phone" action={joinHost} name="host-join" icon={icons.join} {reportError} />
            {/if}
            {#if audioAvailable}<ShellButton label="Enable sound cues" action={enableAudio} name="enable-audio" class="secondary" icon={icons.sound} {reportError} />{/if}
            {#if feedback.length}
              <details id="match-feedback" class="feedback" aria-label="Match feedback">
                <summary id="match-feedback-toggle">{@render icon(icons.feedback)}Match feedback</summary>
                {#each [...feedback].reverse() as event (event.eventSeq)}{@render eventLine(event)}{/each}
              </details>
            {/if}
          {/if}
          <ShellButton label="Leave room" action={leave} name="leave" class="secondary" icon={icons.leave} {reportError} />
          {#if statusInTools}{@render status()}{/if}
        </details>
      </div>
    {:else if snapshot}
      <section class="gameplay" use:attachGame>
        {#if commandStatus}<p class="state-line" role="status">{commandStatus}</p>{/if}
      </section>
      {#if !(snapshot.phase === "lobby" && snapshot.canHost) && trial.trial && snapshot.ownPlayerId && trial.trial.playerIds.includes(snapshot.ownPlayerId)}
        <TrialPanel {...trial} />
      {/if}
      <details id="faction-history">
        <summary id="faction-history-toggle">{@render icon(icons.factions)}Faction changes ({factionHistory.length})</summary>
        <p class="radar-note">{snapshot.canHost ? "All faction changes in this room. Times are local to this device." : "Only changes involving you. Times are local to this device."}</p>
        {#if !historyAvailable}<p class="warning">Full history is unavailable. Reconnect to load saved changes.</p>
        {:else if !factionHistory.length}<p class="radar-note">No faction changes yet. Conversions and host changes will appear here.</p>{/if}
        <ol class="faction-history-list">
          {#each [...factionHistory].reverse() as event (event.eventSeq)}
            <li>
              <time datetime={new Date(event.atMs).toISOString()}>{timeFormat.format(new Date(event.atMs))}</time>
              {@render eventLine(event)}
              {#if event.type === "conversion" && event.oldFaction && event.faction}
                <span class="faction-history-transition">{names[event.oldFaction]} to {names[event.faction]}</span>
              {/if}
            </li>
          {/each}
        </ol>
      </details>
    {:else}<p>Connecting to the private match. Location is not collected.</p>{/if}
  {/each}
  {#if connectionStatus.state === "failed"}
    <ShellButton label="Reconnect" action={reconnect} name="reconnect" class="secondary" icon={icons.refresh} {reportError} />
  {/if}
  {#if !statusInTools}{@render status()}{/if}
{/if}
<footer>
  <details id="safe-play" use:contextDisclosure={{ context: playing, open: !!credentials && !playing }} data-context={playing ? "game" : "setup"}>
    <summary id="safe-play-toggle">{@render icon(icons.safety)}Location and safe play</summary>
    <p>Agree on a bounded outdoor area and safe routes. No running or touching is needed. You can leave without a gameplay penalty. Keep this app visible and the screen on.</p>
    <p>Share location uses browser permission. Players and the host see approximate direction and distance, not raw opponent coordinates. Last-known positions stay on radar, but influence stops after 30 seconds without a new position. Sharing stops when this app is hidden or disconnected. Locations stay only in temporary server memory, not match records or exports. Rooms and credentials expire within 24 hours.</p>
    <p>At round end, room members can see player names, conversion totals, and earned trophies.</p>
  </details>
</footer>

<style>
  #room-tools.setup { display: contents; }
  #room-tools.setup > h2 { margin: 0 0 1.5rem; font-size: 2.25rem; font-weight: 750; letter-spacing: -.035em; }
  @media (max-width: 640px) {
    #room-tools.setup > h2 { font-size: 1.75rem; }
  }
  @media (max-width: 480px) {
    #room-tools.setup :global(> button) { font-size: .85rem; padding-inline: .65rem; }
  }
</style>
