<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>

<div class="blur-backdrop">
  {@render children()}
</div>

<style>
  .blur-backdrop {
    position: relative;
    overflow: clip;
    width: min(100%, 680px);
    height: clamp(240px, 40vw, 360px);
    border-radius: 18px;
    background:
      repeating-linear-gradient(125deg, transparent 0 10px, rgb(255 255 255 / 0.28) 10px 11px, transparent 11px 16px),
      repeating-linear-gradient(35deg, transparent 0 40px, rgb(255 255 255 / 0.18) 40px 41px, transparent 41px 64px),
      radial-gradient(ellipse at 80% 30%, color-mix(in srgb, var(--invite-amber) 65%, var(--danger)), transparent 60%),
      radial-gradient(ellipse at 15% 65%, color-mix(in srgb, color-mix(in srgb, var(--accent), var(--success)) 58%, var(--canvas)), transparent 65%),
      color-mix(in srgb, var(--accent) 20%, var(--surface));
  }
</style>
