<script lang="ts">
  let { compact = false, size = 30 }: { compact?: boolean; size?: number } = $props();
</script>

<span class="brand"><span class="brand-mark" style:width={`${size}px`} style:height={`${size}px`} aria-hidden="true"></span>{#if !compact}<span>Coast</span>{/if}</span>

<style>
  .brand-mark {
    display: block;
    flex: none;
    background: currentColor;
    mask: url('/coast-mark.png') center / contain no-repeat;
    -webkit-mask: url('/coast-mark.png') center / contain no-repeat;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-weight: 750;
    letter-spacing: -0.045em;
    font-size: 20px;
    color: var(--ink);
  }
</style>
