<script lang="ts">
  import { flushSync } from "svelte";
  import { configureSchema, factionSchema, gamePreset, locationInactivityMs } from "../shared/protocol";
  import type { PlayerSnapshot, RuleParameters } from "../shared/protocol";
  import type { HudState, MatchActions } from "./views";
  import { activitySnapshot, clock, names, symbols } from "./views";
  import { icons } from "./icons";
  import Radar from "./Radar.svelte";

  let { snapshot, actions, live, elapsedMs, hud, headingDegrees }: {
    snapshot: PlayerSnapshot; actions: MatchActions; live: boolean; elapsedMs: number;
    hud: HudState | null; headingDegrees: number | null;
  } = $props();
  const activity = $derived(activitySnapshot(snapshot, live, elapsedMs));
  const parameters = $derived(snapshot.parameters ?? gamePreset);
  const activityStopped = $derived((snapshot.outgoing && !activity.outgoing) || snapshot.incoming.length > activity.incoming.length);
  const phase = $derived(snapshot.phase === "lobby" ? "Waiting room" : snapshot.phase === "paused" ? "Paused" :
    snapshot.phase === "ended" ? "Round ended" : "Round running");
  let advancedOpen = $state(false), validation = $state("");
  let hostTools = $state<HTMLDetailsElement>();
  const fields: [keyof RuleParameters, string, number][] = [
    ["entryRadiusM", "Entry radius (m)", 1], ["retentionRadiusM", "Retention radius (m)", 1],
    ["maxAccuracyM", "Influence uncertainty limit (m)", 1], ["dwellMs", "Conversion time (seconds)", 1000],
    ["graceMs", "Grace period (ms)", 1], ["roundDurationMs", "Round duration (minutes)", 60000],
  ];
  function showSettings() {
    if (hostTools) hostTools.open = true;
    flushSync(() => { advancedOpen = true; });
  }
  function configure(event: SubmitEvent) {
    event.preventDefault();
    if (!(event.currentTarget instanceof HTMLFormElement)) return;
    const values = new FormData(event.currentTarget);
    const parsed = configureSchema.safeParse({
      type: "configure", mode: "test", approved: false, deviceLimitations: "",
      parameters: { ...Object.fromEntries(fields.map(([name, , unit]) => {
        const value = Number(values.get(name)) * unit;
        return [name, name === "dwellMs" ? Math.round(value) : value];
      })), freshnessMs: locationInactivityMs },
    });
    if (!parsed.success) {
      validation = "Use positive finite values, whole milliseconds, and retention at least entry.";
      showSettings(); return;
    }
    validation = ""; actions.configure(parsed.data);
  }
</script>

{#snippet uiIcon(source: string)}
  <img class="ui-icon" src={source} alt="" aria-hidden="true" />
{/snippet}

{#snippet countdown(progress: number)}
  {@const seconds = Math.ceil(Math.round(parameters.dwellMs * (1 - progress)) / 1000)}
  <strong class="conversion-countdown">{seconds > 0 ? `${seconds} s left` : "Confirming..."}</strong>
{/snippet}

{#snippet readout()}
  <div data-influence-display class="hud-influence">
    {#if snapshot.phase === "running" && live}
      {#if activity.outgoing}
        {@const target = snapshot.roster.find(p => p.id === activity.outgoing?.targetId)?.label ?? "Player"}
        <div class="influence" data-direction="outgoing">
          <p class="conversion-heading" role="status">You are converting {target}</p>
          <span>{@render countdown(activity.outgoing.progress)}<span>{Math.round(activity.outgoing.progress * 100)}%</span></span>
          <progress max="1" value={activity.outgoing.progress} aria-label="Influencing {target}"></progress>
          <p class="conversion-guidance">Stay in range until confirmed.</p>
        </div>
      {/if}
      {#each activity.incoming as attack (attack.attackerId)}
        {@const attacker = snapshot.roster.find(p => p.id === attack.attackerId)?.label ?? "Player"}
        <div class="influence" data-direction="incoming">
          <p class="conversion-heading" role="status">You are being converted by {attacker}</p>
          <span>{@render countdown(attack.progress)}<span>{Math.round(attack.progress * 100)}%</span></span>
          <progress max="1" value={attack.progress} aria-label="{attacker} is influencing you"></progress>
          <p class="conversion-guidance">Move out of range to stop conversion.</p>
        </div>
      {/each}
      {#if !activity.outgoing && !activity.incoming.length}<p class="radar-note influence-idle">No confirmed influence.</p>{/if}
    {/if}
    {#if activityStopped}
      <p class="conversion-stopped" role="status">Conversion stopped. {snapshot.phase !== "running" ? "The round is not running." :
        !live ? "Reconnect with this app visible to continue." : "Waiting for usable locations."}</p>
    {:else if hud?.interruption && !activity.outgoing && !activity.incoming.length}
      <p class="conversion-stopped" role="status">{hud.interruption}</p>
    {/if}
  </div>
  {#if hud && snapshot.phase !== "ended"}
    <div class="hud-controls">
      {#if hud.locationLabel}
        <div class="location-controls">
          <p class="location-sharing">{hud.locationLabel}</p>
          {#if hud.sharing}
            <button type="button" id="action-stop-sharing" data-action="stop-sharing" class="secondary" onclick={hud.stopSharing}>{@render uiIcon(icons.stopLocation)}Stop sharing</button>
          {:else}
            <button type="button" id="action-round-consent" data-action="round-consent" onclick={hud.shareLocation}>{@render uiIcon(icons.location)}Share location</button>
          {/if}
        </div>
      {/if}
      {#if snapshot.radar}
        <div class="radar-controls" role="group" aria-label="Radar orientation">
          <button type="button" id="action-compass" data-action="compass" class="secondary" aria-pressed={hud.compass.enabled} onclick={hud.toggleCompass}>{@render uiIcon(icons.compass)}Use compass</button>
          <p class="radar-note" data-compass-status role="status">{hud.compass.reason ?? (hud.compass.enabled ? "Heading-up is on." : "North-up. Compass is off.")}</p>
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

<div class="game-hud">
  <header class="hud-heading">
    {#if snapshot.ownFaction}
      <div class="own-faction" data-faction={snapshot.ownFaction}>
        <svg viewBox="0 0 24 24" aria-hidden="true" data-faction-symbol={snapshot.ownFaction}>
          <image href={symbols[snapshot.ownFaction]} width="24" height="24" />
        </svg>
        <h2>{names[snapshot.ownFaction]}</h2>
      </div>
    {:else}<h2>Host view</h2>{/if}
    <div class="hud-round">
      <p class="round-state">{phase}</p>
      {#if snapshot.phase !== "lobby"}<p class="round-clock" aria-label="Round time">{clock(snapshot.remainingMs)}</p>{/if}
    </div>
  </header>
  {#if !snapshot.ownFaction}<p class="radar-note">Host view. Join as a player to participate.</p>{/if}
  {#if snapshot.phase !== "lobby" && snapshot.graceMs}<p class="grace-note">Grace: {clock(snapshot.graceMs)}. You cannot attack or be attacked.</p>{/if}
  {#if snapshot.phase !== "ended"}
    <Radar snapshot={activity} {live} {elapsedMs} {headingDegrees}>{@render readout()}</Radar>
  {/if}
</div>

{#if snapshot.phase === "lobby" || snapshot.phase === "ended" || !snapshot.radar}
  <details id="player-roster" open={snapshot.phase === "lobby"}>
    <summary id="player-roster-toggle">{@render uiIcon(icons.players)}Players ({snapshot.roster.length})</summary>
    <ul class="roster">
      {#each snapshot.roster as player (player.id)}
        <li><img class="faction-icon" data-faction={player.faction} src={symbols[player.faction]} alt="" aria-hidden="true" />{player.label} - {player.faction}{player.id === snapshot.ownPlayerId ? " (you)" : ""}</li>
      {/each}
    </ul>
  </details>
{/if}
{#if snapshot.canHost}
  <section class="host-controls">
    {#if snapshot.phase === "lobby"}
      <button type="button" id="action-start" data-action="start" disabled={snapshot.roster.length < 2} onclick={actions.start}>{@render uiIcon(icons.play)}Start game</button>
      {#if snapshot.roster.length < 2}<p>Invite another player to start.</p>{/if}
    {:else if snapshot.phase === "paused"}
      <button type="button" id="action-begin-resume" data-action="begin-resume" onclick={actions.beginResume}>{@render uiIcon(icons.play)}Resume round</button>
    {/if}
    <details id="host-tools" bind:this={hostTools}>
      <summary id="host-tools-toggle">{@render uiIcon(icons.settings)}Host controls</summary>
      {#if snapshot.phase === "running"}<button type="button" id="action-pause" data-action="pause" onclick={actions.pause}>{@render uiIcon(icons.pause)}Pause round</button>{/if}
      {#if snapshot.phase !== "lobby" && snapshot.phase !== "ended"}
        <button type="button" id="action-end" data-action="end" class="secondary" onclick={actions.end}>{@render uiIcon(icons.stop)}End round</button>
      {/if}
      {#if snapshot.phase !== "ended"}
        <details id="faction-controls">
          <summary id="faction-controls-toggle">{@render uiIcon(icons.factions)}Change player factions</summary>
          <p>A live faction change clears both attack roles and gives the player a grace period.</p>
          {#each snapshot.roster as player (player.id)}
            <label><span><img class="faction-icon" data-faction={player.faction} src={symbols[player.faction]} alt="" aria-hidden="true" />{player.label}</span>
              <select id="faction-{player.id}" data-action="set-faction" aria-label="Faction for {player.label}" value={player.faction}
                onchange={event => {
                  const parsed = factionSchema.safeParse(event.currentTarget.value);
                  event.currentTarget.value = player.faction;
                  if (parsed.success && parsed.data !== player.faction) actions.setFaction(player.id, parsed.data);
                }}>
                {#each ["rock", "paper", "scissors"] as const as faction}
                  <option value={faction} disabled={faction === player.faction}>{names[faction]}</option>
                {/each}
              </select>
            </label>
          {/each}
        </details>
      {/if}
      {#if snapshot.phase === "lobby"}
        <details id="advanced-settings" bind:open={advancedOpen}>
          <summary id="advanced-settings-toggle">{@render uiIcon(icons.adjustments)}Advanced settings</summary>
          <form class="configuration" onsubmit={configure}>
            <h3>Round settings</h3>
            <p>Settings stay fixed while the round is running or paused.</p>
            <div class="form-grid">
              {#each fields as [name, label, unit]}
                <label>{label}
                  <input id={name} {name} type="number" required min="0.001" step={name === "dwellMs" ? "0.001" : "any"} data-retain
                    value={parameters[name] / unit}
                    oninvalid={showSettings} />
                </label>
              {/each}
            </div>
            <button type="submit" data-action="configure">{@render uiIcon(icons.settings)}Save round settings</button>
            {#if validation}<p class="error" role="alert">{validation}</p>{/if}
          </form>
        </details>
      {/if}
      <details id="host-diagnostics">
        <summary id="host-diagnostics-toggle">{@render uiIcon(icons.diagnostics)}Host diagnostics</summary>
        {#if snapshot.feedback?.conversions}
          {@const f = snapshot.feedback}
          <h3>Visible conversion feedback</h3>
          <p>{f.conversionsWithinOneSecond}/{f.conversions} conversions confirmed on both visible player interfaces within one second. {f.conversionsFailed} failed; {f.conversionsPending} pending; {f.missing} missing acknowledgements.</p>
          <p>{f.p95UpperMs === null ? "Display-delay upper-bound p95 is unavailable while acknowledgements are missing." :
            `Display-delay upper-bound p95: ${Math.ceil(f.p95UpperMs)} ms. This is not one-way network latency.`}</p>
        {/if}
      </details>
    </details>
  </section>
{/if}
