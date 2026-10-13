<script lang="ts">
  import { tick } from "svelte";
  import type { PlayerSnapshot, RoundResults as Results } from "../shared/protocol";
  import { awardAchievement, awardSequenceAt, awardSequenceDuration, awardTiming, awardTitles } from "./award-view";
  import AwardAnnouncement from "./AwardAnnouncement.svelte";

  let { results, roster, ownPlayerId, ceremonyStartedAt, finishCeremony, reconnect }: {
    results: Results | undefined; roster: PlayerSnapshot["roster"]; ownPlayerId: string | null;
    ceremonyStartedAt: number | null; finishCeremony: () => void; reconnect?: () => void;
  } = $props();
  let now = $state(performance.now());
  let pausedAt = $state<number | null>(null), pausedMs = $state(0);
  let dialog = $state<HTMLDialogElement>();
  let heading = $state<HTMLHeadingElement>();
  const players = $derived(results?.players ?? roster.map(p => ({ id: p.id, label: p.label, rank: null, conversionsMade: null })));
  const playerListHeading = $derived(!results || results.coverage === "unavailable" ? "Available roster" :
    results.coverage === "partial" ? "Known players" : "All players");
  const awards = $derived(results?.coverage === "complete" ? results.awards : []);
  const sequence = $derived(ceremonyStartedAt === null ? { kind: "results" as const } :
    awardSequenceAt(awards, Math.max(0, (pausedAt ?? now) - ceremonyStartedAt - pausedMs)));
  const currentWinners = $derived(sequence.kind === "award" ?
    players.filter(p => sequence.award.winnerIds.includes(p.id)) : []);
  const announcement = $derived(sequence.kind === "award" ?
    `${awardTitles[sequence.award.id]}. ${currentWinners.map(p => p.label).join(", ")}. ${awardAchievement(sequence.award)}` :
    sequence.kind === "intro" ? "Round complete." : "");

  function finish() {
    dialog?.close();
    finishCeremony();
    void tick().then(() => heading?.focus({ preventScroll: true }));
  }
  function togglePlayback() {
    const time = performance.now();
    now = time;
    if (pausedAt === null) {
      if (ceremonyStartedAt === null) return;
      if (time - ceremonyStartedAt - pausedMs >= awardSequenceDuration(awards)) { finish(); return; }
      pausedAt = time;
    } else {
      pausedMs += time - pausedAt;
      pausedAt = null;
    }
  }
  $effect(() => {
    const started = ceremonyStartedAt, entries = awards, duration = awardSequenceDuration(entries);
    const paused = pausedAt, heldMs = pausedMs;
    if (started === null || !duration || paused !== null) return;
    let timer: ReturnType<typeof setTimeout>;
    const frame = () => {
      const time = performance.now(), age = Math.max(0, time - started - heldMs);
      now = time;
      if (age >= duration) { finish(); return; }
      const phase = awardSequenceAt(entries, age);
      const boundary = phase.kind === "intro" ? awardTiming.introMs :
        phase.kind === "award" ? awardTiming.introMs + (phase.index + 1) * awardTiming.announcementMs : duration;
      timer = setTimeout(frame, Math.min(16, boundary - age));
    };
    frame();
    return () => clearTimeout(timer);
  });
  $effect(() => {
    if (dialog?.isConnected && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>("[data-action='skip-awards']")?.focus();
    }
  });
</script>

<section class="round-results" aria-labelledby="round-results-heading">
  {#if sequence.kind === "results"}<p class="round-state">Round ended</p>{/if}
  <h2 id="round-results-heading" tabindex="-1" bind:this={heading}>Round results</h2>
  {#if !results || results.coverage === "unavailable"}
    <p class="warning" role="status">Round statistics are unavailable.</p>
    <p>Available roster names only. Earlier participants may be missing.</p>
    {#if !results && reconnect}<button type="button" data-action="reconnect-results" onclick={reconnect}>Reconnect</button>{/if}
  {:else if results.coverage === "partial"}
    <p class="warning" role="status">Round statistics are incomplete.</p>
    <p>This list may omit players who left before collection began. Full-round scores and trophies are unavailable.</p>
  {:else if !players.length}
    <p>No players in this round.</p>
  {:else if !awards.length}
    <p>No trophies earned this round.</p>
  {/if}
  <h3>{playerListHeading} ({players.length})</h3>
  <ol class="round-results-list" aria-label={playerListHeading}>
    {#each players as player (player.id)}
      <li data-result-player={player.id} value={player.rank ?? undefined}>
        {#if player.rank !== null}<span class="result-rank" aria-label="Rank {player.rank}">{player.rank}</span>{/if}
        <div class="result-player">
          <strong>{player.label}{player.id === ownPlayerId ? " (you)" : ""}</strong>
          {#if awards.some(a => a.winnerIds.includes(player.id))}
            <ul class="result-trophies" aria-label="Earned trophies">
              {#each awards.filter(a => a.winnerIds.includes(player.id)) as award (award.id)}
                <li>{awardTitles[award.id]}</li>
              {/each}
            </ul>
          {/if}
        </div>
        {#if player.conversionsMade !== null}
          <span class="result-score"><strong>{player.conversionsMade}</strong><span>conversions made</span></span>
        {/if}
      </li>
    {/each}
  </ol>
</section>

{#if ceremonyStartedAt !== null && sequence.kind !== "results"}
  <dialog id="award-ceremony" class="award-dialog" aria-label="Round trophy announcements" bind:this={dialog}
    oncancel={event => { event.preventDefault(); finish(); }}>
    <header class="award-dialog-controls">
      <span>Round ended</span>
      <button id="action-skip-awards" type="button" data-action="skip-awards" onclick={finish}>Skip to results</button>
    </header>
    <div class="award-live-status" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
    {#if sequence.kind === "intro"}
      <div class="award-stage award-introduction"><h2>Round complete</h2></div>
    {:else}
      <AwardAnnouncement award={sequence.award} winners={currentWinners} ageMs={sequence.ageMs} reducedMotion={false}
        paused={pausedAt !== null} {togglePlayback} />
    {/if}
  </dialog>
{/if}
