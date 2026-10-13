<script lang="ts">
  import type { RoundAward, RoundResultPlayer } from "../shared/protocol";
  import { awardAchievement, awardTiming, awardTitles } from "./award-view";
  import { names, symbols } from "./views";

  let { award, winners, ageMs, reducedMotion, paused = false, togglePlayback }: {
    award: RoundAward; winners: readonly Pick<RoundResultPlayer, "id" | "label">[];
    ageMs: number; reducedMotion: boolean; paused?: boolean; togglePlayback?: () => void;
  } = $props();

  function playbackKey(event: KeyboardEvent) {
    if (event.target !== event.currentTarget || event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (!event.repeat) togglePlayback?.();
  }
</script>

{#snippet trophy()}
  <path d="M-38-48H38V-17C38 11 23 28 0 28S-38 11-38-17Z" fill="currentColor" />
  <path d="M-38-37H-59V-23C-59-2-43 9-26 9M38-37H59V-23C59-2 43 9 26 9"
    fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round" />
  <path d="M-5 26H5V46H29V55H-29V46H-5Z" fill="currentColor" />
  <path d="M-20-33H-11V-15C-11-5-8 2-3 6" fill="none" stroke="#171719" stroke-width="5" />
{/snippet}

{#snippet announcement()}
<article class="award-stage" class:is-reduced={reducedMotion} data-award={award.id}
  data-many-winners={winners.length > 3} style:--award-age="{ageMs}ms" style:--award-duration="{awardTiming.announcementMs}ms">
  <h2 class="award-title">{awardTitles[award.id]}</h2>
  <svg class="award-artwork" viewBox="0 0 360 240" aria-hidden="true">
    {#if award.id === "hat_trick"}
      {#each ["rock", "paper", "scissors"] as const as faction, index}
        <g transform="translate({90 + index * 90} 120)">
          <g class="award-hand" data-hand={faction} data-award-motion>
            <circle r="40" fill={faction === "rock" ? "#eb6256" : faction === "paper" ? "#f2cf45" : "#69b5f5"} />
            <image href={symbols[faction]} x="-27" y="-27" width="54" height="54" />
          </g>
        </g>
      {/each}
    {:else if award.id === "comeback_kid"}
      <path class="award-turnaround" d="M45 130C55 205 115 225 160 188S230 115 285 75"
        fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" pathLength="100" data-award-motion />
      <path class="award-turnaround-arrow" d="m267 74 21-2-4 21" fill="none" stroke="currentColor" stroke-width="4" data-award-motion />
      <g transform="translate(180 105)"><g class="award-trophy" data-award-motion>{@render trophy()}</g></g>
    {:else if award.id === "social_butterfly"}
      <g transform="translate(110 15)">
        <path class="award-arch" data-arch="left" data-award-motion fill="#eb6256"
          d="M0 120V42a42 42 0 0 1 84 0v78H56V42a14 14 0 0 0-28 0v78Z" />
        <path class="award-arch" data-arch="right" data-award-motion fill="#69b5f5"
          d="M56 120V42a42 42 0 0 1 84 0v78h-28V42a14 14 0 0 0-28 0v78Z" />
      </g>
      <g transform="translate(180 176) scale(.65)"><g class="award-trophy" data-award-motion>{@render trophy()}</g></g>
    {:else if award.id === "hot_streak"}
      {#each [75, 120, 165] as y, index}
        <path class="award-streak" data-streak={index} data-award-motion d="M35 {y}H325"
          stroke="currentColor" stroke-width="6" stroke-linecap="round" pathLength="100" />
      {/each}
      <g transform="translate(180 116)"><g class="award-trophy" data-award-motion>{@render trophy()}</g></g>
    {:else}
      <path class="award-podium" data-award-motion d="M105 202H255V233H105Z" fill="#fff" />
      <g transform="translate(180 139)"><g class="award-trophy" data-award-motion>{@render trophy()}</g></g>
      <g class="award-curtain" data-curtain="left" data-award-motion>
        <path d="M0 0H180V240H0Z" fill="currentColor" /><path d="M150 0V240" stroke="#171719" stroke-width="2" />
      </g>
      <g class="award-curtain" data-curtain="right" data-award-motion>
        <path d="M180 0H360V240H180Z" fill="currentColor" /><path d="M210 0V240" stroke="#171719" stroke-width="2" />
      </g>
    {/if}
  </svg>
  <div class="award-winner-copy" data-award-motion>
    <ul class="award-winners">
      {#each winners as winner (winner.id)}<li data-award-winner={winner.id}>{winner.label}</li>{/each}
    </ul>
    <p class="award-achievement">{awardAchievement(award)}</p>
    {#if award.id === "comeback_kid"}
      <p class="award-time-note">Excludes pauses, conversion grace, and unusable-location time.</p>
    {/if}
    {#if award.id === "hat_trick"}<p class="award-time-note">{names.rock}, {names.paper}, {names.scissors}. All three sides.</p>{/if}
  </div>
</article>
{/snippet}

{#if togglePlayback}
  <div class="award-playback">
    <div class="award-tap-target" role="button" tabindex="0" data-action="toggle-award-playback"
      aria-label={paused ? "Resume award animation" : "Pause award animation"} aria-pressed={paused}
      onclick={togglePlayback} onkeydown={playbackKey}>
      {@render announcement()}
    </div>
    <button type="button" class="award-playback-hint" data-action="pause-awards" aria-pressed={paused} onclick={togglePlayback}>
      {paused ? "Paused. Tap to resume" : "Tap to pause"}
    </button>
  </div>
{:else}
  {@render announcement()}
{/if}
