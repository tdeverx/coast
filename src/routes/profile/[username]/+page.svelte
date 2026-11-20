<script lang="ts">
  import ProfileDetails from '#lib/profile/Details.svelte';
  import SectionDetails from '#lib/ui/pages/SectionDetails.svelte';
  let { data } = $props();
</script>

{#if data.row}<SectionDetails href={data.row.href} artwork={data.row.artwork} />
{:else if data.profile}<ProfileDetails data={data.profile} />{/if}
