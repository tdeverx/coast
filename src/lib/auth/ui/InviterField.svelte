<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import Avatar from '#lib/ui/components/Avatar.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import TextLink from '#lib/ui/components/TextLink.svelte';
  import { slideFade } from '#lib/ui/slide-fade.js';
  import AuthSurface from './AuthSurface.svelte';

  let { name, avatar, profile, hydrated, children }: {
    name?: string | null; avatar?: string | null; profile?: string | null; hydrated: boolean; children: Snippet;
  } = $props();
  let selected = $state(true);
  let frame = $state<HTMLFieldSetElement>();
  $effect(() => { if (!name) selected = true; });

  async function setSelected(value: boolean) {
    selected = value;
    await tick();
    frame?.querySelector<HTMLButtonElement>(value ? '.auth-side-action button' : '.inset-row-action')?.focus({preventScroll:true});
  }
</script>

<AuthSurface expanded={!!name}>
  {#if name}
    <div transition:slideFade>
      <div class="menu-row inviter-identity">
        <span class="inviter-avatar" aria-hidden="true"><Avatar {name} src={avatar} size={24}/></span>
        <span class="inviter-name" class:linked={!!profile}>
          {#if profile}<TextLink href={profile} text={name}/>{:else}{name}{/if}
        </span>
        <span class="inviter-note menu-row-note">Invited you</span>
      </div>
    </div>
  {/if}
  {@render children()}
  {#if name}
    <fieldset class="auth-action-frame friend-reveal" bind:this={frame} transition:slideFade
      onoutrostart={event => { event.currentTarget.disabled = true; }}
      onintrostart={event => { event.currentTarget.disabled = false; }}>
      <div class="inviter-row">
        <div class="menu-row">Accept their friend request?</div>
        {#if !hydrated}
          <label class="check"><input type="checkbox" name="addInviter" bind:checked={selected}/>Sure</label>
        {:else if selected}
          <span class="friend-status menu-row-note">Pending</span>
          <input type="hidden" name="addInviter" value="on"/>
        {:else}
          <Button class="inset-row-action" emphasis="subtle" label={`Sure, accept ${name}’s friend request`} onclick={() => setSelected(true)}>Sure</Button>
        {/if}
      </div>
      {#if hydrated && selected}
        <div class="auth-side-action centered">
          <Button size="icon" emphasis="subtle" icon="minusCircle" danger label={`Remove ${name} from friend selection`}
            title="Remove friend" onclick={() => setSelected(false)}/>
        </div>
      {/if}
    </fieldset>
  {/if}
</AuthSurface>

<style>
  .inviter-avatar {
    display: grid;
    grid-template: 100% / 100%;
    place-items: center;
    flex: none;
    inline-size: var(--menu-icon-size);
    block-size: var(--menu-icon-size);
  }
  .inviter-name {
    --text-link-gap: 2px;
    flex: 1;
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inviter-name.linked { overflow: visible; }
  .inviter-name :global(svg) { inline-size: 12px; block-size: 12px; }
  .inviter-note { white-space: nowrap; }
  .menu-row.inviter-identity:hover, .inviter-row > .menu-row:hover {
    background: transparent;
    color: var(--menu-row-ink);
  }
  .friend-reveal { min-inline-size: 0; padding: 0; border: 0; }
  .inviter-row {
    display:grid;
    grid-template-columns:minmax(0,1fr) auto;
    align-items:center;
    gap:var(--menu-inset);
  }
  .friend-status { padding-inline:var(--menu-item-inset); }
</style>
