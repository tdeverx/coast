<script lang="ts">
  import type { TraktAccess } from './access.js';

  let { access = $bindable(), disabled = false }: { access: TraktAccess; disabled?: boolean } = $props();
</script>

<div class="stack" role="group" aria-label="Trakt sync permissions">
  <input type="hidden" name="import" value="false" />
  <label class="check">
    <input type="checkbox" name="import" value="true" bind:checked={access.import} {disabled} />
    Import from Trakt
  </label>
  <input type="hidden" name="export" value="false" />
  <label class="check">
    <input type="checkbox" name="export" value="true" bind:checked={access.export} {disabled} />
    Export to Trakt
  </label>
  <p class="small">Import reads your personal Trakt activity into Coast. Export sends supported changes you make in Coast to your Trakt account.</p>
</div>
