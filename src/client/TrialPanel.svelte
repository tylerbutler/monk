<script lang="ts">
  import type { PlayerSnapshot, TrialSample, TrialStatus, TrialSummary } from "../shared/protocol";
  import { icons } from "./icons";
  import ShellButton from "./ShellButton.svelte";

  let { snapshot, trial, latest, summary, diagnosticStatus, requestingPermission,
    begin, agree, decline, end, exportSummary, discard, reportError }: {
    snapshot: PlayerSnapshot | null; trial: TrialStatus | null; latest: TrialSample | null; summary: TrialSummary | null;
    diagnosticStatus: string; requestingPermission: boolean;
    begin: () => void; agree: () => void; decline: () => void; end: () => void;
    exportSummary: () => void; discard: () => void; reportError: (reason: string) => void;
  } = $props();
  let pair = $state(["", ""]);
  $effect(() => {
    const roster = snapshot?.roster ?? [];
    for (let i = 0; i < pair.length; i++) {
      if (!roster.some(player => player.id === pair[i])) pair[i] = roster[i]?.id ?? "";
    }
  });
  function initialOpen(node: HTMLDetailsElement, open: boolean) { node.open = open; }
  function showTrial(node: HTMLDetailsElement, active: boolean) {
    node.open = active;
    return { update(next: boolean) { if (next) node.open = true; } };
  }
</script>

<details class="trial" id="location-trial" use:showTrial={!!trial}>
  <summary id="location-trial-toggle"><img class="ui-icon" src={icons.location} alt="" aria-hidden="true" />Optional location measurement</summary>
  <p>Both selected players must agree to measurements. This does not change ordinary sharing or block the game.</p>
  {#if diagnosticStatus}<p class="radar-note">{diagnosticStatus}</p>{/if}
  <details id="trial-devices" use:initialOpen={!summary}>
    <summary id="trial-devices-toggle"><img class="ui-icon" src={icons.settings} alt="" aria-hidden="true" />Device pair and conditions</summary>
    <div class="form-grid">
      {#each [0, 1] as i}
        <label>Phone {i + 1} model<input type="text" name="device-{i}" id="device-{i}" data-retain /></label>
        <label>Phone {i + 1} iOS version<input type="text" name="os-{i}" id="os-{i}" data-retain /></label>
        <label>Phone {i + 1} mode
          <select id="mode-{i}" data-retain>
            {#each ["Safari tab", "Installed PWA", "Other browser"] as mode}<option>{mode}</option>{/each}
          </select>
        </label>
      {/each}
    </div>
    <label>Outdoor conditions (do not enter names or coordinates)<input type="text" name="conditions" id="conditions" data-retain /></label>
  </details>
  {#if snapshot?.canHost}
    <div hidden={!!trial}>
      <div class="form-grid">
        {#each [0, 1] as i}
          <label>Trial player {i + 1}
            <select id="pair-{i}" bind:value={pair[i]} data-retain>
              {#each snapshot.roster as player (player.id)}
                <option value={player.id}>{player.label}</option>
              {/each}
            </select>
          </label>
        {/each}
        <label>Marked reference separation (metres)<input type="number" name="referenceM" id="referenceM" min="0" step="any" inputmode="decimal" data-retain /></label>
      </div>
      <ShellButton label="Request trial consent" action={begin} name="trial-begin" {reportError} />
    </div>
  {/if}
  {#if trial}
    <p class="state-line">{trial.collecting ? "Trial collecting. Keep both apps visible." : "Waiting for both players to agree."}</p>
    {#if snapshot?.ownPlayerId && trial.playerIds.includes(snapshot.ownPlayerId) && !trial.readyIds.includes(snapshot.ownPlayerId)}
      <ShellButton label={requestingPermission ? "Requesting location access..." : "Agree and collect location"}
        action={agree} name="trial-ready" disabled={requestingPermission} {reportError} />
      <ShellButton label="Decline trial" action={decline} name="trial-decline" class="secondary" {reportError} />
    {/if}
    <ShellButton label="Stop trial" action={end} name="trial-end" class="secondary" {reportError} />
    <p>{trial.referenceM === null ? "No reference separation entered." : `Reference separation: ${trial.referenceM} m`}</p>
  {/if}
  {#if latest}
    <dl class="measurements">
      <dt>Estimated distance</dt><dd>{latest.distanceM.toFixed(1)} m</dd>
      <dt>Reported uncertainty</dt><dd>{latest.uncertaintiesM.map(v => `${v.toFixed(1)} m`).join(" / ")}</dd>
      <dt>Sample age</dt><dd>{latest.agesMs.map(v => `${Math.round(v)} ms`).join(" / ")}</dd>
      <dt>Update gap</dt><dd>{latest.updateGapsMs.map(v => `${v} ms`).join(" / ")}</dd>
      <dt>Capture-to-receipt upper bound</dt><dd>{latest.delayBoundsMs.map(v => `${Math.ceil(v[1])} ms`).join(" / ")}</dd>
      <dt>Clock uncertainty</dt><dd>{latest.clockUncertaintiesMs.map(v => `${v} ms`).join(" / ")}</dd>
    </dl>
  {/if}
  {#if summary}
    <p>{summary.sampleCount} samples. Results are provisional and device-specific.</p>
    <ShellButton label="Export measurement summary" action={exportSummary} name="export-trial" class="secondary" {reportError} />
    {#if !trial}<ShellButton label="Discard measurement summary" action={discard} name="discard-trial" class="secondary" {reportError} />{/if}
  {/if}
</details>
