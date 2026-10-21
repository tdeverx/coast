<script lang="ts">
  import type { Snippet } from 'svelte';
  import {useRetention} from '#lib/ui/retention.js';
  import {onDestroy,tick} from 'svelte';
  import Button from './Button.svelte';
  import Toast from './Toast.svelte';
  import { useClient } from '#lib/ui/client-context.js';
  import { liquidGlass } from '#lib/ui/materials/glass.js';
  import type { ComponentProps } from 'svelte';
  let {
    open = $bindable(false),
    title,
    children, message, actions, alert = false,
    wide = false, edgeToEdge = false, expanding = false, popover = false, popoverWidth = 560, anchor, heading, footer, floating,
    onclose,contentKey,
  }: {
    open: boolean;
    title: string;
    children?: Snippet; message?: string; alert?: boolean; actions?: ComponentProps<typeof Button>[];
    wide?: boolean; edgeToEdge?: boolean; expanding?:boolean; popover?: boolean; popoverWidth?:number; anchor?:string; heading?:Snippet; footer?:Snippet; floating?:Snippet;
    onclose?: () => void;contentKey?:string;
  } = $props();
  const {feedback} = useClient();
  const retain=useRetention();
  $effect(()=>{if(open)return retain();});
  const hostId = $props.id();
  $effect(()=>{if(open)return feedback.host(hostId);});
  let dialog: HTMLElement;
  let destroyed = false;
  let placementFrame = 0;
  let expansionFrame = 0;
  const expansionDistance=160;
  let expansion = 0;
  let expanded=$state(false);
  let expansionScroll=$state<HTMLDivElement>();
  let detailScroll=$state<HTMLDivElement>();
  let cancelHandoff=()=>{};
  $effect(()=>{
    contentKey;
    if(!open||!expanding||!detailScroll)return;
    cancelHandoff();
    if(expansionFrame){cancelAnimationFrame(expansionFrame);expansionFrame=0;}
    // Reset the page within the current presentation, not the presentation itself.
    detailScroll.scrollTop=0;
    if(expansionScroll)expansionScroll.scrollTop=expansion*expansionDistance;
    const current=contentKey;
    void tick().then(()=>{if(!destroyed&&open&&contentKey===current)dialog?.querySelector<HTMLElement>('button:not(:disabled),a[href]')?.focus({preventScroll:true});});
  });
  function expandSheet() {
    if (expansionFrame || !expanding) return;
    expansionFrame=requestAnimationFrame(()=>{
      expansionFrame=0;
      if (!destroyed && open && expansionScroll) {
        // Reverse momentum can remain latched to this track. Content must reach
        // its top before the outer track may change the sheet presentation.
        if(detailScroll && detailScroll.scrollTop>0.5 && expansionScroll.scrollTop<expansionDistance)expansionScroll.scrollTop=expansionDistance;
        const next=Math.min(1,Math.max(0,expansionScroll.scrollTop/expansionDistance));
        expanded=next===1;
        if(next!==expansion){
          if((next===0)!==(expansion===0))dialog.style.setProperty('--detail-hero-text-align',next===0?'center':'left');
          expansion=next;dialog.style.setProperty('--detail-expansion',String(next));
        }
      }
    });
  }
  function scrollPage(){
    // Keyboard focus may scroll an off-screen control before pointer scrolling expands the sheet.
    if(!expanded&&detailScroll?.scrollTop&&expansionScroll){expansionScroll.scrollTop=expansionDistance;expandSheet();}
  }
  function handoffScroll(node:HTMLDivElement){
    let position:number|undefined;
    let direction=0;
    let settle:ReturnType<typeof setTimeout>|undefined;
    const snap=node.style.scrollSnapType;
    function cancel(){
      if(settle!==undefined)clearTimeout(settle);
      settle=undefined;
      position=undefined;
      node.style.scrollSnapType=snap;
    }
    cancelHandoff=cancel;
    function move(delta:number){
      if(settle!==undefined)clearTimeout(settle);
      position=Math.max(0,Math.min(expansionDistance,(position??node.scrollTop)+delta));
      direction=Math.sign(delta);
      // A snapped scrollTop assignment can immediately return to the same end.
      // Keep one gesture's travel until it settles, then restore native snapping.
      node.style.scrollSnapType='none';
      node.scrollTop=position;
      expandSheet();
      const pending=setTimeout(()=>{
        if(settle!==pending)return;
        if(!destroyed&&open&&position!==undefined){
          node.scrollTop=direction<0?0:expansionDistance;
          expandSheet();
        }
        cancel();
      },120);
      settle=pending;
    }
    function wheel(event:WheelEvent){
      const content=detailScroll;
      // A wheel gesture can remain latched to the expansion track after it reaches its end.
      // Forward its remaining vertical travel without requiring another pointer hit test.
      if(!open||destroyed||!content||event.defaultPrevented||event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY)||!content.contains(event.target as Node)){cancel();return;}
      const delta=event.deltaY*(event.deltaMode===1?20:event.deltaMode===2?content.clientHeight:1);
      if(!delta)return;
      for(let target=event.target as HTMLElement;target&&target!==content;target=target.parentElement!){
        if(target.scrollHeight<=target.clientHeight)continue;
        const style=window.getComputedStyle(target);
        if(!/^(auto|scroll)$/.test(style.overflowY))continue;
        if(style.overscrollBehaviorY==='contain'||style.overscrollBehaviorY==='none'||(delta>0?target.scrollTop<target.scrollHeight-target.clientHeight:target.scrollTop>0)){cancel();return;}
      }
      if(position!==undefined&&!event.cancelable){cancel();return;}
      if(delta>0&&node.scrollTop<expansionDistance-0.5&&content.scrollTop<=0.5){
        if(position!==undefined&&event.cancelable){event.preventDefault();move(delta);}
        return;
      }
      if(delta<0&&content.scrollTop<=0.5){
        // A gesture latched to content also needs an explicit handoff at its top.
        // Non-cancelable events retain their native travel to avoid applying it twice.
        if(event.cancelable&&node.scrollTop>0){event.preventDefault();content.scrollTop=0;move(delta);}
        return;
      }
      cancel();
      const next=Math.max(0,Math.min(content.scrollHeight-content.clientHeight,content.scrollTop+delta));
      if(next===content.scrollTop)return;
      // Later events may be non-cancelable. expandSheet pins reverse outer travel
      // while content still has upward scroll remaining.
      if(event.cancelable)event.preventDefault();
      content.scrollTop=next;
    }
    node.addEventListener('wheel',wheel,{passive:false});
    return {destroy(){cancel();if(cancelHandoff===cancel)cancelHandoff=()=>{};node.removeEventListener('wheel',wheel);}};
  }
  let returnFocus:HTMLElement|null=null;
  function closed() {
    if(destroyed)return;
    // Native close events are queued: an older event must not close a reopened dialog.
    if(!popover&&(dialog as HTMLDialogElement)?.open)return;
    if(dialog?.contains(document.activeElement)&&returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
    returnFocus=null;open=false;onclose?.();
  }
  onDestroy(() => {destroyed = true;cancelHandoff();if(placementFrame)cancelAnimationFrame(placementFrame);if(expansionFrame)cancelAnimationFrame(expansionFrame);});
  function placePopover() {
    if (destroyed || !open || !dialog) return;
    const target = anchor ? document.querySelector(anchor) : null;
    const bounds = target?.getBoundingClientRect();
    const width = dialog.getBoundingClientRect().width;
    const top = Math.min(bounds ? bounds.bottom + 8 : 16, Math.max(16, window.innerHeight - 160));
    const left = Math.max(16, Math.min((bounds?.right ?? window.innerWidth - 16) - width, window.innerWidth - width - 16));
    dialog.style.setProperty('--popover-top', `${top}px`);
    dialog.style.setProperty('--popover-left', `${left}px`);
  }
  function schedulePopover() {
    if (destroyed || !open || placementFrame) return;
    placementFrame = requestAnimationFrame(() => {
      placementFrame = 0;
      placePopover();
    });
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
      window.addEventListener('resize', schedulePopover);
      window.addEventListener('scroll', schedulePopover, true);
      return () => {
        cancelAnimationFrame(placementFrame);
        placementFrame = 0;
        window.removeEventListener('resize', schedulePopover);
        window.removeEventListener('scroll', schedulePopover, true);
      };
    }
    const modal = dialog as HTMLDialogElement;
    if (open && !modal.open) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      modal.showModal();
      if(expanding){expansion=0;expanded=false;if(expansionScroll)expansionScroll.scrollTop=0;dialog.style.setProperty('--detail-expansion','0');dialog.style.setProperty('--detail-hero-text-align','center');if(detailScroll)detailScroll.scrollTop=0;}
    }
    if (!open) {cancelHandoff();if(expansionFrame){cancelAnimationFrame(expansionFrame);expansionFrame=0;}if(modal.open)modal.close();}
  });
</script>

<svelte:element this={popover ? 'div' : 'dialog'}
  class="dialog"
  style:--popover-width={`${popoverWidth}px`}
  style:--detail-expansion-distance={`${expansionDistance}px`}
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
  class:detail-expanded={expanded}
  class:wide class:edge-to-edge={edgeToEdge} class:expanding class:notification-popover={popover}
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
  {:else if expanding}
    <div class="detail-sheet solid-surface media-surface-edge">
      <div class="detail-expansion-scroll" bind:this={expansionScroll} onscroll={expandSheet} use:handoffScroll>
        <div class="detail-expansion-track">
          <div class="sheet-settle" aria-hidden="true"></div><div class="expanded-settle" aria-hidden="true"></div>
          <div class="detail-stage">
            <div class="detail-scroll" data-shelf-scroll bind:this={detailScroll} onscroll={scrollPage}>
              <div class="detail-body">
                <div class="detail-heading">{@render dialogHeading()}</div>{@render dialogContent()}{@render footer?.()}
              </div>
            </div>
          </div>
        </div>
      </div>
      {@render floating?.()}
    </div>
  {:else}{@render dialogHeading()}{@render dialogContent()}{@render footer?.()}{/if}
  {#if feedback.activeHost === hostId && feedback.current}
    <div class="dialog-feedback"><Toast text={feedback.current.text} kind={feedback.current.kind} error={feedback.current.error} busy={feedback.current.busy} actionLabel={feedback.current.undo?'Undo':feedback.current.actionLabel??'Retry'} onaction={feedback.current.undo || feedback.current.retry ? feedback.act : undefined} ondismiss={()=>feedback.clear()} /></div>
  {/if}
</svelte:element>

<style>
  .dialog-feedback {position:sticky;bottom:0;z-index:2;flex:none;margin-top:16px;}
  .notification-popover > .dialog-feedback {margin:0;padding:12px 16px;}
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
  .dialog.edge-to-edge {padding:0;}
  .dialog.expanding {--detail-expansion:0;--detail-inset:min(48px,6dvh);--detail-width:min(864px,calc(100vw - 32px));--detail-viewport-height:calc(100dvh - 2 * var(--detail-inset) * (1 - var(--detail-expansion)));position:fixed;inset:0;width:calc(var(--detail-width) + (100vw - var(--detail-width)) * var(--detail-expansion));max-width:none;height:var(--detail-viewport-height);max-height:none;margin:auto;padding:0;border:0;border-radius:calc(36px * (1 - var(--detail-expansion)));background:transparent;box-shadow:none;overflow:visible;}
  .detail-expansion-scroll {height:100%;overflow-anchor:none;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;border-radius:inherit;scroll-snap-type:y proximity;}
  .detail-expansion-track {position:relative;height:calc(100% + var(--detail-expansion-distance));border-radius:inherit;}
  .detail-stage {position:sticky;top:0;height:calc(100% - var(--detail-expansion-distance));border-radius:inherit;}
  .detail-scroll {height:100%;overflow-anchor:none;overflow-y:hidden;scrollbar-gutter:stable;border-radius:inherit;}
  .detail-expanded .detail-scroll {overflow-y:auto;}
  .detail-sheet {height:100%;border-radius:inherit;border:0;position:relative;isolation:isolate;}
  .detail-sheet::after {z-index:12;border-width:2px;opacity:calc(var(--media-surface-edge-opacity) * (1 - var(--detail-expansion)));}
  .detail-body {position:relative;min-height:100%;}
  .detail-sheet :global(.content.details.page) {padding-top:72px;}
  .sheet-settle,.expanded-settle {position:absolute;left:0;right:0;pointer-events:none;scroll-snap-align:start;}
  .sheet-settle {top:0;height:1px;}
  .expanded-settle {top:var(--detail-expansion-distance);height:1px;}
  .detail-heading {position:sticky;top:0;z-index:10;}
  .edge-to-edge .heading {padding:16px 24px;margin-bottom:0;}
  .notification-popover {--popover-inset:16px;position:fixed;inset:auto;top:var(--popover-top,16px);left:var(--popover-left,16px);width:min(var(--popover-width),calc(100vw - 32px));max-height:min(640px,calc(100dvh - var(--popover-top,16px) - 16px));margin:0;border-radius:16px;padding:0;overflow:hidden;}
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
