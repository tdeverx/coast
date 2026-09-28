<script lang="ts">
  import Button from './Button.svelte';
  let {
    page,
    pages,
    pageUrl,
    onchange,
    busy = false,
    label,
  }: {
    page: number;
    pages: number;
    pageUrl?: (page: number) => string;
    onchange?: (page: number) => void;
    busy?: boolean;
    label: string;
  } = $props();
</script>

{#if pages > 1}<nav class="spread section" aria-label={label}>
    <Button
      variant="secondary"
      disabled={busy || page <= 1}
      href={pageUrl?.(page - 1)}
      onclick={onchange ? () => onchange(page - 1) : undefined}>Previous</Button
    >
    <p class="small">Page {page} of {pages}</p>
    <Button
      variant="secondary"
      disabled={busy || page >= pages}
      href={pageUrl?.(page + 1)}
      onclick={onchange ? () => onchange(page + 1) : undefined}>Next</Button
    >
  </nav>{/if}
