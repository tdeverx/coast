<script lang="ts">
  import Icon from './Icon.svelte';
  let {href,text,onclick}: {href:string;text:string;onclick?:(event:MouseEvent)=>void}=$props();
</script>

<a {href} {onclick}><span>{text}</span><Icon name="right" size={12}/></a>

<style>
  a { display:inline-flex; align-items:center; gap:4px; max-width:100%; min-width:0; vertical-align:bottom; color:inherit; font-weight:var(--weight-semibold); }
  span { min-width:0; overflow:hidden; text-overflow:ellipsis; }
  a :global(svg) { flex-shrink:0; opacity:0.6; }
  a:hover :global(svg), a:focus-visible :global(svg) { opacity:1; }
</style>
