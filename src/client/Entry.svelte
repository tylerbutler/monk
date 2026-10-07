<script lang="ts">
  import { gamePreset } from "../shared/protocol";
  import { icons } from "./icons";
  import { names, symbols, targets } from "./views";
  import pairedMark from "../../brand/assets/symbol-paired.svg?url";

  let { invitedCode, error, errorField, create, join, reportError }: {
    invitedCode: string | null; error: string; errorField: string;
    create: (label: string) => Promise<void>;
    join: (code: string, label: string) => Promise<void>;
    reportError: (reason: string, field?: string) => void;
  } = $props();
  let nameInput = $state<HTMLInputElement>();
  let creating = $state(false), joining = $state(false);

  async function createRoom() {
    creating = true;
    try { await create(nameInput?.value.trim() ?? ""); }
    catch (failure) { reportError(failure instanceof Error ? failure.message : "Request failed. Try again."); }
    finally { creating = false; }
  }
  async function joinRoom(event: SubmitEvent) {
    event.preventDefault();
    if (!(event.currentTarget instanceof HTMLFormElement)) return;
    const code = String(new FormData(event.currentTarget).get("matchCode") ?? "").trim().toUpperCase();
    if (!/^[A-Z2-9]{8}$/.test(code)) {
      reportError("Enter the eight-character room code.", "matchCode"); return;
    }
    joining = true;
    try { await join(code, nameInput?.value.trim() ?? ""); }
    catch (failure) { reportError(failure instanceof Error ? failure.message : "Join failed. Try again."); }
    finally { joining = false; }
  }
</script>

{#snippet createButton()}
  <button type="button" id="action-create" data-action="create" class:secondary={!!invitedCode}
    disabled={creating} aria-busy={creating} onclick={createRoom}><img class="ui-icon" src={icons.create} alt="" aria-hidden="true" />{creating ? "Creating room..." : "Create room"}</button>
{/snippet}

<div class="entry-layout" data-invited={String(!!invitedCode)}>
  {#if !invitedCode}
    <div class="entry-intro">
      <div>
        <h2>Change sides.<br />Keep playing.</h2>
        <p>An outdoor Rock, Paper, Scissors game for friends.</p>
      </div>
      <img src={pairedMark} alt="" width="140" height="120" />
    </div>
  {/if}
  <section id="play" tabindex="-1" aria-labelledby="play-heading">
    <h2 id="play-heading">{invitedCode ? "Join your friends." : "Play with friends"}</h2>
    {#if invitedCode}<p>You are invited to room <strong>{invitedCode}</strong>.</p>{/if}
    <label>Display name (optional)
      <input id="displayName" name="displayName" maxlength="80" autocomplete="off" data-retain bind:this={nameInput} />
    </label>
    {#if !invitedCode}{@render createButton()}{/if}
    {#if error && errorField !== "matchCode"}<p class="error" role="alert">{error}</p>{/if}
    <form class="join-form" onsubmit={joinRoom}>
      <label hidden={!!invitedCode}>Room code
        <input id="matchCode" name="matchCode" value={invitedCode ?? ""} required maxlength="8"
          autocomplete="off" autocapitalize="characters" spellcheck="false" data-retain
          aria-invalid={error && errorField === "matchCode" ? "true" : undefined}
          aria-describedby={error && errorField === "matchCode" ? "room-code-hint room-code-error" : !invitedCode ? "room-code-hint" : undefined} />
      </label>
      {#if !invitedCode}<p class="input-help" id="room-code-hint">Enter the eight-character code from your host.</p>{/if}
      {#if error && errorField === "matchCode"}<p class="error" id="room-code-error" role="alert">{error}</p>{/if}
      <button type="submit" id="action-join" disabled={joining} aria-busy={joining}><img class="ui-icon" src={icons.join} alt="" aria-hidden="true" />{joining ? "Joining room..." : "Join room"}</button>
    </form>
    {#if invitedCode}{@render createButton()}{/if}
    <p class="entry-safety">Location sharing stays off until you choose Share location. Agree on a safe outdoor play area.</p>
  </section>
</div>

<section id="how-to-play" class="rules" aria-labelledby="rules-heading">
  <h2 id="rules-heading">How to play</h2>
  <ul class="faction-cycle">
    {#each ["rock", "scissors", "paper"] as const as faction}
      <li data-faction={faction}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><image href={symbols[faction]} width="24" height="24" /></svg>
        <div><strong>{names[faction]}</strong><span>converts {names[targets[faction]]}</span></div>
      </li>
    {/each}
  </ul>
  <ol class="rules-steps">
    {#each [
      ["Find your target", "Your faction decides who you can convert. Check the player list and radar for targets and threats."],
      ["Stay in range", "Stay near your target while the progress bar fills. Wait for the conversion to be confirmed."],
      ["Change sides. Keep playing.", "When someone converts you, join their faction and stay in the game. Your targets change too."],
    ] as [heading, description]}
      <li><h3>{heading}</h3><p>{description}</p></li>
    {/each}
  </ol>
  <details id="rules-details" class="rules-setup">
    <summary>Full rules and round settings</summary>
    <p>Conversion starts automatically when both players share usable locations and the game confirms range. Stay in range for {gamePreset.dwellMs / 1000} seconds by default. An interruption resets progress. Players in your own faction cannot convert you.</p>
    <p>After conversion, a short grace period prevents anyone from converting you again. Your targets and threats change with your faction.</p>
    <h3>Before you start</h3>
    <p>Create a room or join with an invite link or room code. The host can start with two players. A round lasts {gamePreset.roundDurationMs / 60000} minutes by default, or until the host ends it. The host can change the settings before play.</p>
    <p>Select Share location when you are ready to take part in conversions. Keep the app visible and the screen on. Radar positions are approximate; a nearby marker alone does not confirm a conversion.</p>
  </details>
</section>
