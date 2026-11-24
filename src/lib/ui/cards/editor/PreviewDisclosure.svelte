<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon, { type IconName } from '#lib/ui/components/Icon.svelte';
  import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';

  let { label, icon, note, children }: {
    label: string; icon: IconName; note?: string; children: Snippet;
  } = $props();
  const id = $props.id();
  let expanded = $state(false);
  let mounted = $state(false);

  function toggle() {
    expanded = !expanded;
    if (expanded || matchMedia('(prefers-reduced-motion: reduce)').matches) mounted = expanded;
  }

  function releaseDetails(event: TransitionEvent) {
    if (!expanded && event.target === event.currentTarget && event.propertyName === 'grid-template-rows') mounted = false;
  }
</script>

<div class="disclosure">
  <AuthSurface>
    <button id={`${id}-label`} type="button" class="menu-row" aria-expanded={expanded} aria-controls={id}
      onclick={toggle}>
      <Icon name={icon} size={16} />
      <span class="row-label">{label}</span>
      {#if note}<span class="menu-row-note disclosure-note" title={note}>{note}</span>{/if}
      <span class="chevron" class:expanded aria-hidden="true"><Icon name="right" size={16} /></span>
    </button>
  </AuthSurface>
  <div {id} class="details" class:expanded inert={!expanded} role="group" aria-labelledby={`${id}-label`}
    ontransitionend={releaseDetails}>
    <div class="details-clip">{#if mounted}<div class="details-content">{@render children()}</div>{/if}</div>
  </div>
</div>

<style>
  .disclosure { min-inline-size:0; }
  .row-label { flex:1; min-inline-size:0; }
  .disclosure-note { max-inline-size:55%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .chevron { display:inline-flex; flex:none; transition:transform var(--motion) var(--ease); }
  .chevron.expanded { transform:rotate(90deg); }
  .details {
    display:grid;
    grid-template-rows:0fr;
    visibility:hidden;
    opacity:0;
    transition:grid-template-rows var(--motion) var(--ease), opacity var(--fast) ease, visibility 0s var(--motion);
  }
  .details.expanded { grid-template-rows:1fr; visibility:visible; opacity:1; transition-delay:0s; }
  .details-clip { min-block-size:0; overflow:visible clip; }
  .details-content { display:grid; gap:var(--editor-auth-gap); padding-block-start:var(--editor-action-gap); }
  @media (prefers-reduced-motion:reduce) { .details, .chevron { transition:none; } }
</style>
