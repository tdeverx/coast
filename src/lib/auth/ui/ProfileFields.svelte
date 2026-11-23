<script lang="ts">
  import Icon from '#lib/ui/components/Icon.svelte';
  import Field from '#lib/ui/components/Field.svelte';
  let { displayName = $bindable(''), bio = $bindable('') }: { displayName?: string; bio?: string } = $props();
</script>
  <Field label="Display name" hideLabel class="menu-row">
    <Icon name="userCheck" />
    <input name="displayName" bind:value={displayName} placeholder="Display name" maxlength="60" autocomplete="nickname" />
    <span class="menu-row-note">Optional</span>
  </Field>
  <Field label="Bio" hideLabel class="menu-row">
    <Icon name="list" />
    <textarea name="bio" bind:value={bio} placeholder="Bio" maxlength="240" rows="1"></textarea>
    <span class="menu-row-note">Optional</span>
  </Field>
<style>textarea { field-sizing: content; resize: none; }</style>
