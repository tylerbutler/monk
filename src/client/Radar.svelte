<script lang="ts">
  import type { Snippet } from "svelte";
  import type { PlayerSnapshot } from "../shared/protocol";
  import { gamePreset } from "../shared/protocol";
  import { icons } from "./icons";
  import { attackFor, combatLabel, isCurrentPosition, names, radarLayout, radarRoles, relationship, symbols, targets, updated } from "./views";

  let { snapshot, live, elapsedMs, headingDegrees, children }: {
    snapshot: PlayerSnapshot; live: boolean; elapsedMs: number; headingDegrees: number | null; children: Snippet;
  } = $props();
  const radar = $derived(snapshot.radar);
  const reference = $derived(radar?.reference);
  const referenceCurrent = $derived(live && !!reference && isCurrentPosition(reference, elapsedMs));
  const layout = $derived(radarLayout(snapshot));
  const heading = $derived(headingDegrees ?? 0);
  const maxAccuracy = $derived(snapshot.parameters?.maxAccuracyM ?? gamePreset.maxAccuracyM);
  const referenceName = $derived(reference?.playerId === snapshot.ownPlayerId ? "you" :
    snapshot.roster.find(p => p.id === reference?.playerId)?.label ?? "Player");
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const guide = $derived(snapshot.ownFaction ? [
    { relation: "target" as const, faction: targets[snapshot.ownFaction] },
    { relation: "threat" as const, faction: targets[targets[snapshot.ownFaction]] },
  ] : []);
</script>

<div class="radar-layout" data-match-activity>
  {#if radar}
    <section class="player-overview" aria-label="Player distances">
      <h3>{snapshot.phase === "lobby" ? `Players (${snapshot.roster.length})` : "Player distances"}</h3>
      <p class="distance-reference">{reference ? `Approximate distances from ${referenceName}.` : snapshot.phase === "lobby" ? "Location sharing is optional." : "Location needed for distances."}</p>
      <ol class="radar-players">
        {#each radar.players as p (p.playerId)}
          {@const player = snapshot.roster.find(player => player.id === p.playerId)}
          {#if player}
            {@const relation = relationship(snapshot, player.faction, player.id)}
            {@const attack = attackFor(snapshot, player.id)}
            {@const current = referenceCurrent && isCurrentPosition(p.position, elapsedMs)}
            <li data-player-id={player.id} data-relationship={relation} data-current={String(current)}
              data-influence={!attack ? "none" : snapshot.outgoing?.targetId === player.id ? "outgoing" : "incoming"}>
              <div class="player-summary">
                <div class="radar-player-heading">
                  <strong><img class="faction-icon" data-faction={player.faction} src={symbols[player.faction]} alt="" aria-hidden="true" />{player.label}</strong>
                  <span class="player-faction">{names[player.faction]}</span>
                  {#if relation !== "player"}<span class="radar-relationship" data-relationship={relation}>{radarRoles[relation].label}</span>{/if}
                </div>
                {#if p.position}
                  <p class="player-distance">
                    <span class="distance-qualifier">{p.position.distanceM === 0 ? "Within about " : "about "}</span><strong>{p.position.distanceM === 0 ? 5 : p.position.distanceM} m</strong>{p.position.distanceM === 0 ? "." : ` ${directions[p.position.bearingDegrees / 45]}`}
                  </p>
                {:else}<p class="player-distance unavailable">Waiting for location.</p>{/if}
              </div>
              {#if attack}<p class="radar-combat-status">{combatLabel(snapshot, player)} - {Math.round(attack.progress * 100)}%.</p>{/if}
              {#if p.position}
                {#if !current}<p class="radar-location-state">Last-known position.</p>{/if}
                {#if p.position.accuracyM > maxAccuracy || (reference && reference.accuracyM > maxAccuracy)}<p class="radar-location-state">Location is approximate.</p>{/if}
                <details class="player-location-details">
                  <summary>Location details</summary>
                  <p class="radar-note">GPS uncertainty {p.position.accuracyM} m. {updated(p.position.ageMs, elapsedMs)}.</p>
                </details>
              {/if}
            </li>
          {/if}
        {/each}
      </ol>
      {#if !radar.players.length}<p class="radar-note">No other players to show yet.</p>{/if}
    </section>
  {/if}
  {#if snapshot.phase !== "lobby" || reference}
    <section class="player-radar" aria-label="Player radar" data-radar-display>
    {#if snapshot.ownFaction}
      <div class="radar-guide" aria-label="Faction guide">
        {#each guide as { relation, faction }}
          <span class="radar-guide-item">
            <span class="radar-role-badge" data-relationship={relation} aria-hidden="true">{radarRoles[relation].symbol}</span>
            <span>{radarRoles[relation].label}: {names[faction]}</span>
          </span>
        {/each}
      </div>
    {/if}
    {#if !live}<p class="state-line warning">Offline or hidden. Showing last-known positions.</p>{/if}
    {#if reference}
      <figure>
        <svg viewBox="0 0 320 320" aria-hidden="true" data-radar>
          <circle cx="160" cy="160" r="136" class="radar-face" />
          {#each [60, 120] as radius}
            <circle cx="160" cy="160" r={radius} class="radar-ring" />
            <text x="166" y={160 - radius - 5} class="radar-range-label">{layout.scale * radius / 120} m</text>
          {/each}
          <g data-radar-world transform="rotate({-heading} 160 160)">
            <path d="M160 40V280M40 160H280" class="radar-axis" />
            {#if snapshot.parameters}
              <circle cx="160" cy="160" r={120 * snapshot.parameters.entryRadiusM / layout.scale} class="radar-entry" />
            {/if}
            {#each [["North", 160, 19], ["S", 160, 311], ["E", 307, 165], ["W", 13, 165]] as [direction, x, y]}
              <text {x} {y} text-anchor="middle" class="radar-compass" data-radar-upright transform="rotate({heading} {x} {y})">{direction}</text>
            {/each}
            <g>
              {#each layout.markers as m (m.player.id)}
                {#if m.markerX !== m.x || m.markerY !== m.y}
                  <line x1={m.x} y1={m.y} x2={m.markerX} y2={m.markerY} class="radar-leader" />
                  <circle cx={m.x} cy={m.y} r="3" class="radar-estimate" />
                {/if}
                {#if m.attack}
                  <line x1={m.from.x} y1={m.from.y} x2={m.to.x} y2={m.to.y}
                    class="radar-link-base {m.influence}" />
                  <line x1={m.from.x} y1={m.from.y} x2={m.to.x} y2={m.to.y}
                    data-from={m.attack.attackerId} data-to={m.attack.targetId} class="radar-link {m.influence}" />
                  <path d={m.arrow} class="radar-arrow {m.influence}" />
                {/if}
              {/each}
            </g>
            <g>
              {#each layout.markers as m (m.player.id)}
                {@const relation = relationship(snapshot, m.player.faction, m.player.id)}
                {@const role = radarRoles[relation]}
                <g transform="translate({m.markerX} {m.markerY})" data-radar-player={m.player.id}
                  data-relationship={relation} data-influence={m.influence} data-faction={m.player.faction}
                  data-current={String(referenceCurrent && isCurrentPosition(m.position, elapsedMs))} class="radar-marker">
                  <title>{m.index + 1}. {m.player.label} - {names[m.player.faction]} - {role.label}{m.attack ? `. ${combatLabel(snapshot, m.player)} - ${Math.round(m.attack.progress * 100)}%.` : ""}</title>
                  <g data-radar-upright transform="rotate({heading} 0 0)">
                    {#if m.attack}
                      <circle r="22" class="radar-progress-track" />
                      <circle r="22" pathLength="100" transform="rotate(-90)"
                        stroke-dasharray="{m.attack.progress * 100} 100" class="radar-progress {m.influence}" />
                    {/if}
                    <circle r="16" class="radar-marker-body" />
                    <svg x="-11" y="-11" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" data-faction-symbol={m.player.faction}>
                      <image href={symbols[m.player.faction]} width="24" height="24" />
                    </svg>
                    <text x="20" y="-14" class="radar-number">{m.index + 1}</text>
                    {#if role.symbol}
                      <g transform="translate(-19 19)" class="radar-role" data-relationship={relation}>
                        <circle r="9" />
                        <text y="4" text-anchor="middle" data-radar-role>{role.symbol}</text>
                      </g>
                    {/if}
                  </g>
                </g>
              {/each}
            </g>
          </g>
          <circle cx="160" cy="160" r="7" class="radar-center" data-current={String(referenceCurrent)} />
          <text x="160" y="186" text-anchor="middle" class="radar-compass">{reference.playerId === snapshot.ownPlayerId ? "You" : "Reference"}</text>
        </svg>
        <figcaption class="radar-note">Rings: {layout.scale / 2} m / {layout.scale} m{reference.playerId !== snapshot.ownPlayerId ? `. Reference: ${referenceName}` : ""}</figcaption>
      </figure>
      {#if !isCurrentPosition(reference, elapsedMs)}<p class="radar-location-state">Last-known position.</p>{/if}
      {#if reference.accuracyM > maxAccuracy}<p class="warning radar-note">Location is approximate.</p>{/if}
    {:else}
      <p class="radar-empty">Waiting for location.</p>
    {/if}
    </section>
  {/if}
  <div class="hud-readout">{@render children()}</div>
  {#if radar}
    <details id="radar-details" class="radar-details">
      <summary id="radar-details-toggle"><img class="ui-icon" src={icons.players} alt="" aria-hidden="true" />Radar details ({snapshot.roster.length})</summary>
      <p class="radar-note" data-radar-orientation-note>{headingDegrees === null ? "North stays at the top." : "Heading-up: the top follows your phone."} Numbers match the player list.</p>
      <p class="radar-note">T: target. !: threat. =: same faction. Faction roles only. Arrows and rings show confirmed influence. Dashed circle: entry radius. Thin lines locate offset markers.</p>
      <p class="radar-note">Influence must stay confirmed until the bar fills. Leaving range or losing location quality stops progress.</p>
      {#if reference}
        <p class="state-line">Reference: {referenceName}</p>
        <p class="radar-note">GPS uncertainty {reference.accuracyM} m. {updated(reference.ageMs, elapsedMs)}.</p>
      {/if}
    </details>
  {/if}
</div>
