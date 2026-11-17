<script lang="ts">
  import Button from './Button.svelte';
  let {mode,disabled=false,change}:{mode?:'activity'|'fixed';disabled?:boolean;change:(mode:'activity'|'fixed')=>unknown}=$props();
</script>
<Button menu text="Background" label="Profile background">
  <Button item selection="radio" checked={mode==='activity'} {disabled} keepOpen={false} onclick={()=>change('activity')}>Last activity</Button>
  <Button item selection="radio" checked={mode!=='activity'} {disabled} keepOpen={false} onclick={()=>change('fixed')}>Selected title</Button>
</Button>
