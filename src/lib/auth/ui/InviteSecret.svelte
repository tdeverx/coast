<script lang="ts">
  import {invitePath} from '#lib/auth/invites.js';
  import {actionFeedback} from '#lib/ui/action-feedback.svelte.js';
  import Button from '#lib/ui/components/Button.svelte';
  let {codes}:{codes:string[]}=$props();
  async function copy(value:string,label:string){
    try {await navigator.clipboard.writeText(value);actionFeedback.notify(label+' copied.');}
    catch {actionFeedback.failure('Could not access the clipboard. Select the code or link to copy it.');}
  }
</script>

{#if codes.length}
  <div class="stack">
    <p>Copy these now. Coast only shows them once.</p>
    {#each codes as code (code)}
      {@const link=typeof location==='undefined'?invitePath(code):location.origin+invitePath(code)}
      <div class="row"><label class="field">Code<input readonly value={code} onfocus={event=>event.currentTarget.select()} /></label>
        <Button emphasis="subtle" onclick={()=>copy(code,'Invite code')}>Copy code</Button></div>
      <div class="row"><label class="field">Link<input readonly value={link} onfocus={event=>event.currentTarget.select()} /></label>
        <Button emphasis="subtle" onclick={()=>copy(link,'Invite link')}>Copy link</Button></div>
    {/each}
  </div>
{/if}
