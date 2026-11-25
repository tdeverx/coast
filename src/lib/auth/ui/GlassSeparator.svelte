<script lang="ts">
  import AuthSurface from './AuthSurface.svelte';
  import { liquidGlass } from '#lib/ui/materials/glass.js';
</script>

<div class="separator" aria-hidden="true">
  <AuthSurface anchor><div class="glass pill" use:liquidGlass={{ variant: 'clear' }}></div></AuthSurface>
</div>

<style>
  .separator { display: flex; justify-content: center; }
  .pill { inline-size: 32px; block-size: var(--auth-action-gap); border-radius: var(--glass-surface-radius); }
</style>
