<script lang="ts">
  let { label, action, name, class: className = "", icon, disabled = false, reportError }: {
    label: string; action: () => void | Promise<void>; name: string; class?: string;
    icon?: string; disabled?: boolean; reportError: (reason: string) => void;
  } = $props();
  let busy = $state(false);
  async function run() {
    busy = true;
    try { const result = action(); if (result) await result; }
    catch (failure) { reportError(failure instanceof Error ? failure.message : "Request failed. Try again."); }
    finally { busy = false; }
  }
</script>

<button type="button" id="action-{name}" data-action={name} class={className}
  disabled={disabled || busy} aria-busy={busy || undefined} onclick={run}>
  {#if icon}<img class="ui-icon" src={icon} alt="" aria-hidden="true" />{/if}{label}
</button>
