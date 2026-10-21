<script lang="ts">
 import type {Snippet} from 'svelte';
 import Dialog from './Dialog.svelte';
 import Button from './Button.svelte';
 import {provideDetailSection} from '#lib/ui/detail-section.svelte.js';
 import SegmentedControl from './SegmentedControl.svelte';
 let {open=$bindable(false),editions=[],editionName=$bindable(),children,onclose,onback,contentKey,sectionPage=false}:{open:boolean;editions?:{value:string;label:string}[];editionName?:string;children?:Snippet;onclose?:()=>void;onback?:()=>void;contentKey?:string;sectionPage?:boolean}=$props();
 const sectionView=$derived(sectionPage||!!contentKey&&!!new URL(contentKey,'http://coast/').searchParams.get('section'));
 const section=provideDetailSection(()=>sectionView,()=>contentKey);
</script>
<Dialog bind:open title={section.title||"Media details"} wide edgeToEdge expanding {onclose} {contentKey}>
 {#snippet heading()}<div class="overlay-controls" style:--detail-controls={onback?2:1}>
  {#if onback}<Button icon="left" material="clear" class="detail-back-button" label="Back within media details" onclick={onback}/>{/if}
  {#if !sectionView&&editions.length>1}<SegmentedControl label="Edition" material="clear" presentation="navigation" options={editions} value={editionName??editions[0].value} onchange={value=>editionName=value}/>{/if}
  {#if sectionView&&section.title}<h1 class="section-title">{section.title}</h1>{/if}
  <div class="section-actions">{#if sectionView}{@render section.controls?.()}{/if}
  <Button icon="close" material="clear" class="detail-close-button" label="Close media details" onclick={()=>open=false}/></div>
 </div>{/snippet}
 {#snippet floating()}{#if sectionView&&section.segments}<nav class="section-navigation" aria-label={`${section.title} selection`}>{@render section.segments()}</nav>{/if}{/snippet}
 {@render children?.()}
</Dialog>
<style>
 .overlay-controls {display:flex;align-items:flex-start;gap:12px;height:0;position:relative;top:16px;padding-inline:16px;pointer-events:none;}
 .overlay-controls :global(.picker-container) {pointer-events:auto;max-width:calc(100% - var(--detail-controls) * 52px);}
 .overlay-controls :global(.detail-close-button),.overlay-controls :global(.detail-back-button) {pointer-events:auto;flex:none;width:40px;height:40px;padding:0;border-radius:50%;}
 .section-actions {margin-left:auto;display:flex;align-items:center;gap:8px;pointer-events:auto;}
 .section-title {position:absolute;left:112px;right:112px;top:8px;text-align:center;font-size:var(--text-xl);font-weight:var(--weight-bold);line-height:var(--leading-tight);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;}
 .section-navigation {position:absolute;bottom:max(16px,env(safe-area-inset-bottom));left:16px;right:16px;z-index:11;display:flex;align-items:center;justify-content:center;gap:12px;pointer-events:none;}
 .section-navigation :global(.picker-container) {pointer-events:auto;max-width:100%;}
</style>
