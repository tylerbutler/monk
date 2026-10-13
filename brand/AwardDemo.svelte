<script lang="ts">
  import { untrack } from "svelte";
  import type { AwardId } from "../src/shared/protocol";
  import AwardAnnouncement from "../src/client/AwardAnnouncement.svelte";
  import RoundResults from "../src/client/RoundResults.svelte";
  import { awardTitles, awardTiming, awardSequenceAt, awardSequenceDuration } from "../src/client/award-view";
  import { awardFixtures, awardFixtureLabels, type AwardFixtureId } from "./award-fixtures";

  let fixtureId = $state<AwardFixtureId>("normal");
  let category = $state<AwardId>("conversion_champion");
  let mode = $state<"award" | "full" | "results">("award");
  let elapsed = $state(1500), playing = $state(false);
  let preference = $state<"system" | "reduced">("system"), systemReduced = $state(false);
  let canvas = $state<HTMLDivElement>();
  const fixture = $derived(awardFixtures[fixtureId]);
  const awards = $derived(fixture.awards);
  const selectedAward = $derived(awards.find(a => a.id === category));
  const duration = $derived(mode === "full" ? awardSequenceDuration(awards) : awardTiming.announcementMs);
  const sequence = $derived(awardSequenceAt(awards, elapsed));
  const currentAward = $derived(mode === "award" ? selectedAward : sequence.kind === "award" ? sequence.award : undefined);
  const currentAge = $derived(mode === "award" ? elapsed : sequence.kind === "award" ? sequence.ageMs : 0);
  const winners = $derived(fixture.players.filter(p => currentAward?.winnerIds.includes(p.id)));
  const hasPlayback = $derived(mode !== "results" && (mode === "award" ? !!selectedAward : awards.length > 0));

  function showPreview() { canvas?.scrollIntoView({ block: "start", behavior: "instant" }); }
  function resetPreview() { playing = false; mode = "award"; elapsed = 1500; showPreview(); }
  function replay() { playing = false; mode = "award"; elapsed = 0; playing = true; showPreview(); }
  function playFull() { playing = false; mode = "full"; elapsed = 0; playing = true; showPreview(); }
  function togglePlayback() {
    if (playing) playing = false;
    else { if (elapsed >= duration) elapsed = 0; playing = true; }
  }
  $effect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { systemReduced = media.matches; };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  });
  $effect(() => {
    if (!playing) return;
    const offset = untrack(() => elapsed), start = performance.now(), end = duration;
    let frame: number;
    const advance = (now: number) => {
      elapsed = Math.min(end, Math.round(offset + now - start));
      if (elapsed >= end) playing = false;
      else frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  });
  $effect(() => {
    const hide = () => { if (document.hidden) playing = false; };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  });
</script>

<main class="award-preview">
  <header class="masthead">
    <a href="./index.html" aria-label="Monk identity kit"><img src="./assets/wordmark.svg" width="128" height="40" alt="Monk" /></a>
    <a href="./conversion-motion.html">Conversion motion</a>
  </header>
  <div class="preview-heading">
    <p class="preview-eyebrow">Motion study / End of round</p>
    <h1>Trophies take the stage.</h1>
    <p>Five entrances. One production stage. Replay an award or inspect the full ceremony.</p>
    <p class="preview-note">Fictional data. Testing preview only.</p>
  </div>
  <div class="demo-workspace">
    <div class="demo-canvas" bind:this={canvas}>
      <div class="playback-controls">
        <button type="button" onclick={replay} disabled={!selectedAward}>Replay award</button>
        <button type="button" class="secondary" onclick={playFull} disabled={!awards.length}>Play full ceremony</button>
        <button type="button" class="secondary" onclick={togglePlayback} disabled={!hasPlayback}>{playing ? "Pause" : "Resume"}</button>
        <button type="button" class="secondary" onclick={() => { playing = false; mode = "results"; showPreview(); }}>Show fixture results</button>
      </div>
      <div class="demo-stage" class:is-results={mode === "results" || mode === "full" && sequence.kind === "results"}>
        {#if mode === "results" || mode === "full" && sequence.kind === "results"}
          <RoundResults results={fixture} roster={[]} ownPlayerId={null} ceremonyStartedAt={null} finishCeremony={() => {}} />
        {:else if mode === "full" && sequence.kind === "intro"}
          <div class="award-stage award-introduction"><h2>Round complete</h2></div>
        {:else if currentAward}
          <AwardAnnouncement award={currentAward} {winners} ageMs={currentAge} reducedMotion={preference === "reduced" || systemReduced}
            paused={!playing} togglePlayback={togglePlayback} />
        {:else}
          <p class="unearned">This trophy was not earned in this fixture</p>
        {/if}
      </div>
      <div class="demo-timeline">
        <label for="award-position">Sequence position</label>
        <input id="award-position" type="range" min="0" max={duration} step="1" value={elapsed} disabled={!hasPlayback}
          oninput={event => { playing = false; elapsed = Number(event.currentTarget.value); }} />
        <output for="award-position" aria-live="off">{elapsed} ms / {duration} ms</output>
      </div>
      <p class="preview-status" role="status">{playing ? (mode === "full" ? "Playing full ceremony." : "Playing award.") :
        mode === "results" || mode === "full" && sequence.kind === "results" ? "Full results. Every collected player stays in the list." :
        "Paused. Drag the timeline or use its arrow keys to inspect each millisecond."}</p>
    </div>
    <aside class="demo-controls" aria-label="Preview controls">
      <label for="award-fixture">Fixture</label>
        <select id="award-fixture" bind:value={fixtureId} onchange={resetPreview}>
          {#each Object.entries(awardFixtureLabels) as [id, label]}<option value={id}>{label}</option>{/each}
        </select>
      <label for="award-category">Award category</label>
        <select id="award-category" bind:value={category} onchange={resetPreview}>
          {#each Object.entries(awardTitles) as [id, label]}<option value={id}>{label}</option>{/each}
        </select>
      <label for="award-preference">Motion preference</label>
        <select id="award-preference" bind:value={preference} onchange={showPreview}><option value="system">System preference</option><option value="reduced">Reduced motion</option></select>
      {#if systemReduced}<p class="preview-note">System reduced motion is on. Travel is off in both modes.</p>{/if}
      <p class="preview-note">500 ms introduction, then 6,000 ms per earned award. Tap the stage to pause or resume. No game connection, location, or sound.</p>
    </aside>
  </div>
</main>

<style>
  .award-preview { width: min(100% - 2rem, 74rem); }
  .masthead img { display: block; width: 128px; height: auto; }
  .masthead a { min-height: 44px; display: inline-flex; align-items: center; }
  .preview-heading { margin-bottom: 2rem; }
  .preview-heading h1 { font-size: clamp(2.2rem, 6vw, 4rem); line-height: 1.05; font-weight: 750; letter-spacing: -.045em; }
  .preview-eyebrow { font-size: .8rem; font-weight: 750; margin-bottom: 1rem; }
  .preview-note { color: var(--muted); font-size: .85rem; }
  .demo-workspace { display: grid; grid-template-columns: minmax(0, 1fr) 19rem; align-items: start; gap: 2rem; }
  .demo-canvas, .demo-controls { min-width: 0; }
  .demo-stage { background: var(--ink); color: #fff; }
  .demo-stage.is-results { color: var(--ink); background: #fff; border-block: 1px solid var(--line); padding-block: 1rem; }
  .unearned { display: grid; place-items: center; min-height: 28rem; padding: 2rem; margin: 0; text-align: center; }
  .demo-controls { border-top: 2px solid var(--ink); padding-top: .5rem; }
  .demo-controls label:first-child { margin-top: 0; }
  .playback-controls { position: sticky; top: 0; z-index: 1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem; padding-bottom: .5rem; background: #fff; }
  .playback-controls button { width: 100%; margin: 0; }
  .demo-timeline { margin-top: 1rem; }
  .demo-timeline label { margin-bottom: 0; }
  .demo-timeline input { accent-color: var(--ink); padding: 0; margin: 0; }
  .demo-timeline output { display: block; font-variant-numeric: tabular-nums; font-size: .9rem; }
  .preview-status { font-size: .85rem; color: var(--muted); }
  @media (max-width: 52rem) {
    .demo-workspace { grid-template-columns: minmax(0, 1fr); gap: 1rem; }
    .demo-controls { margin-top: .5rem; }
    .masthead { align-items: flex-start; }
    .masthead > a:last-child { max-width: 12ch; text-align: right; justify-content: end; }
  }
</style>
