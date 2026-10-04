<script lang="ts">
  import type { Snippet } from "svelte";
  import type { PlayerSnapshot } from "../shared/protocol";
  import { gamePreset } from "../shared/protocol";
  import { attackFor, combatLabel, isCurrentPosition, names, radarLayout, radarRoles, relationship, symbols, targets, updated } from "./views";

  let { snapshot, live, elapsedMs, headingDegrees, children }: {
    snapshot: PlayerSnapshot; live: boolean; elapsedMs: number; headingDegrees: number | null; children: Snippet;
  } = $props();
  const radar = $derived(snapshot.radar);
  const reference = $derived(radar?.reference);
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
          <g data-radar-world transform="rotate({-heading} 160 160)">
            <circle cx="160" cy="160" r="60" class="radar-ring" />
            <circle cx="160" cy="160" r="120" class="radar-ring" />
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
                  data-current={String(live && isCurrentPosition(m.position, elapsedMs))} class="radar-marker">
                  <title>{m.index + 1}. {m.player.label} - {names[m.player.faction]} - {role.label}{m.attack ? `. ${combatLabel(snapshot, m.player)} - ${Math.round(m.attack.progress * 100)}%.` : ""}</title>
                  <g data-radar-upright transform="rotate({heading} 0 0)">
                    {#if m.attack}
                      <circle r="22" class="radar-progress-track" />
                      <circle r="22" pathLength="100" transform="rotate(-90)"
                        stroke-dasharray="{m.attack.progress * 100} 100" class="radar-progress {m.influence}" />
                    {/if}
                    <circle r="16" class="radar-marker-body" />
                    <svg x="-11" y="-11" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" data-faction-symbol={m.player.faction}>
                      <path d={symbols[m.player.faction]} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
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
          <circle cx="160" cy="160" r="7" class="radar-center" data-current={String(live && isCurrentPosition(reference, elapsedMs))} />
          <text x="160" y="186" text-anchor="middle" class="radar-compass">{reference.playerId === snapshot.ownPlayerId ? "You" : "Reference"}</text>
        </svg>
        <figcaption class="radar-note">Outer ring: {layout.scale} m{reference.playerId !== snapshot.ownPlayerId ? `. Reference: ${referenceName}` : ""}</figcaption>
      </figure>
      {#if !isCurrentPosition(reference, elapsedMs)}<p class="radar-location-state">Last-known position.</p>{/if}
      {#if reference.accuracyM > maxAccuracy}<p class="warning radar-note">Location is approximate.</p>{/if}
    {:else}
      <p class="radar-empty">Waiting for location.</p>
    {/if}
  </section>
  <div class="hud-readout">{@render children()}</div>
  {#if radar}
    <details id="radar-details" class="radar-details">
      <summary id="radar-details-toggle">Players &amp; radar details ({snapshot.roster.length})</summary>
      <p class="radar-note" data-radar-orientation-note>{headingDegrees === null ? "North stays at the top." : "Heading-up: the top follows your phone."} Numbers match the player list.</p>
      <p class="radar-note">T: target. !: threat. =: same faction. Faction roles only. Arrows and rings show confirmed influence. Dashed circle: entry radius. Thin lines locate offset markers.</p>
      <p class="radar-note">Influence must stay confirmed until the bar fills. Leaving range or losing location quality stops progress.</p>
      {#if reference}
        <p class="state-line">Reference: {referenceName}</p>
        <p class="radar-note">GPS uncertainty {reference.accuracyM} m. {updated(reference.ageMs, elapsedMs)}.</p>
      {/if}
      <ol class="radar-players">
        {#each radar.players as p (p.playerId)}
          {@const player = snapshot.roster.find(player => player.id === p.playerId)}
          {#if player}
            {@const relation = relationship(snapshot, player.faction, player.id)}
            {@const attack = attackFor(snapshot, player.id)}
            <li data-player-id={player.id} data-relationship={relation}
              data-influence={!attack ? "none" : snapshot.outgoing?.targetId === player.id ? "outgoing" : "incoming"}>
              <div class="radar-player-heading">
                <strong>{player.label} - {names[player.faction]}</strong>
                {#if relation !== "player"}<span class="radar-relationship" data-relationship={relation}>{radarRoles[relation].label}</span>{/if}
              </div>
              {#if attack}<p class="radar-combat-status">{combatLabel(snapshot, player)} - {Math.round(attack.progress * 100)}%.</p>{/if}
              {#if p.position}
                <p>{p.position.distanceM === 0 ? "Within about 5 m." : `about ${p.position.distanceM} m ${directions[p.position.bearingDegrees / 45]}`}</p>
                <p class="radar-note">GPS uncertainty {p.position.accuracyM} m. {updated(p.position.ageMs, elapsedMs)}.</p>
                {#if p.position.accuracyM > maxAccuracy}<p class="radar-note">Location is approximate.</p>{/if}
                {#if !live || !isCurrentPosition(p.position, elapsedMs)}<p class="radar-location-state">Last-known position.</p>{/if}
              {:else}<p class="radar-note">Waiting for location.</p>{/if}
            </li>
          {/if}
        {/each}
      </ol>
    </details>
  {/if}
</div>
