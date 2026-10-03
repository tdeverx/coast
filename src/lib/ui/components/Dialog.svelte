<script lang="ts">
  import type { Snippet } from 'svelte';
  import {onDestroy,tick} from 'svelte';
  import Button from './Button.svelte';
  import { liquidGlass } from '$lib/ui/materials/glass';
  import type { ComponentProps } from 'svelte';
  let {
    open = $bindable(false),
    title,
    children, message, actions, alert = false,
    wide = false, popover = false, anchor, heading, footer,
    onclose,
  }: {
    open: boolean;
    title: string;
    children?: Snippet; message?: string; alert?: boolean; actions?: ComponentProps<typeof Button>[];
    wide?: boolean; popover?: boolean; anchor?:string; heading?:Snippet; footer?:Snippet;
    onclose?: () => void;
  } = $props();
  let dialog: HTMLElement;
  let destroyed = false;
  let returnFocus:HTMLElement|null=null;
  function closed() {
    if(dialog?.contains(document.activeElement)&&returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
    returnFocus=null;open=false;onclose?.();
  }
  onDestroy(() => {destroyed = true;});
  function placePopover() {
    const target = anchor ? document.querySelector(anchor) : null;
    const bounds = target?.getBoundingClientRect();
    const width = dialog.getBoundingClientRect().width;
    const top = Math.min(bounds ? bounds.bottom + 8 : 16, Math.max(16, window.innerHeight - 160));
    const left = Math.max(16, Math.min((bounds?.right ?? window.innerWidth - 16) - width, window.innerWidth - width - 16));
    dialog.style.setProperty('--popover-top', `${top}px`);
    dialog.style.setProperty('--popover-left', `${left}px`);
  }
  $effect(() => {
    if (!dialog) return;
    if (popover) {
      if (open && !dialog.matches(':popover-open')) {
        returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
        dialog.showPopover();
        void tick().then(()=>{if(!destroyed&&dialog.matches(':popover-open'))dialog.querySelector<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled)')?.focus({preventScroll:true});});
      }
      if (!open && dialog.matches(':popover-open')) dialog.hidePopover();
      if (!open) return;
      placePopover();
      window.addEventListener('resize', placePopover);
      window.addEventListener('scroll', placePopover, true);
      return () => {
        window.removeEventListener('resize', placePopover);
        window.removeEventListener('scroll', placePopover, true);
      };
    }
    const modal = dialog as HTMLDialogElement;
    if (open && !modal.open) modal.showModal();
    if (!open && modal.open) modal.close();
  });
</script>

<svelte:element this={popover ? 'div' : 'dialog'}
  class="dialog"
  class:solid-surface={!popover}
  class:glass={popover}
  use:liquidGlass={{variant:'glassDark',enabled:popover,renderer:'css'}}
  popover={popover ? 'auto' : undefined}
  role={popover ? 'dialog' : undefined}
  aria-label={title}
  bind:this={dialog}
  onclose={closed}
  ontoggle={(event: ToggleEvent) => {
    if (!destroyed && popover && event.oldState === 'open' && event.newState === 'closed') {
      closed();
    }
  }}
  class:wide class:notification-popover={popover}
  onclick={(e: MouseEvent) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        open = false;
    }
  }}
  onkeydown={() => {}}
>
  {#snippet dialogHeading()}
  {#if heading}{@render heading()}{:else}<div class="spread heading">
    <h2>{title}</h2>
    <Button compact icon="close" label="Close dialog" onclick={() => (open = false)} />
  </div>
  {/if}
  {/snippet}
  {#snippet dialogContent()}
  {#if message}<div class="stack"><p role={alert ? 'alert' : undefined}>{message}</p><div class="row">{#each actions ?? [] as action}<Button {...action} />{/each}</div></div>{/if}
  {@render children?.()}
  {/snippet}
  {#if popover}
    <div class="popover-heading">{@render dialogHeading()}</div>
    <div class="popover-content">{@render dialogContent()}</div>
    {#if footer}<div class="popover-footer">{@render footer()}</div>{/if}
  {:else}{@render dialogHeading()}{@render dialogContent()}{@render footer?.()}{/if}
</svelte:element>

<style>
  .dialog {
    color: var(--ink);
    border-radius: 12px;
    padding: 24px;
    width: min(512px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    overflow-y: auto;
    margin: auto;
  }
  .dialog.wide {
    border-radius: 16px;
    width: min(864px, calc(100vw - 32px));
  }
  .notification-popover {--popover-inset:16px;position:fixed;inset:auto;top:var(--popover-top,16px);left:var(--popover-left,16px);width:min(560px,calc(100vw - 32px));max-height:min(640px,calc(100dvh - var(--popover-top,16px) - 16px));margin:0;border-radius:16px;padding:0;overflow:hidden;}
  .notification-popover:popover-open{display:flex;flex-direction:column;}
  .popover-heading{flex:none;padding:12px var(--popover-inset);border-bottom:1px solid var(--line);}
  .popover-content{min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:var(--popover-inset);}
  .popover-footer{position:relative;z-index:1;flex:none;border-top:1px solid var(--line);}
  .popover-heading :global(.row-header){margin-bottom:0;flex-wrap:nowrap;gap:8px;}
  .popover-heading :global(.identity){flex-basis:auto;min-width:0;}
  .popover-heading :global(.actions){flex:none;margin-left:0;}
  .dialog::backdrop {
    background: color-mix(in srgb, var(--canvas) 75%, transparent);
  }
  .notification-popover::backdrop {background:transparent;}
  .heading {
    margin-bottom: 22px;
  }
</style>
