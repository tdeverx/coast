<script lang="ts">
  import { displayLabel } from '$lib/ui/labels';
  import { change, message } from '$lib/ui/client';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  type Conflict = {
    id: string;
    mediaId: string;
    kind?: string;
    title: string;
    source: string;
    action: string;
    value: boolean | null;
    positionSeconds: number | null;
    durationSeconds: number | null;
    occurredAt: Date | string;
    reason: string | null;
    localValue?: Record<string, unknown>;
    remoteValue?: Record<string, unknown>;
  };
  function describe(value: Record<string, unknown>) {
    if (value.deleted) return 'Deleted';
    if ('positionSeconds' in value)
      return `${Math.floor(Number(value.positionSeconds) / 60)}m ${Math.floor(Number(value.positionSeconds) % 60)}s`;
    if ('items' in value)
      return `${value.name} · ${Array.isArray(value.items) ? value.items.length : 0} titles${value.description ? ` · ${value.description}` : ''}`;
    return value.value === true
      ? 'Yes'
      : value.value === false
        ? 'No'
        : value.value === null
          ? 'Not set'
          : String(value.value ?? 'Not set');
  }
  let { conflicts }: { conflicts: Conflict[] } = $props();
  let error = $state(''),
    selected = $state<Conflict | null>(null),
    busy = $state(false);
  async function resolve(conflict: Conflict, decision: 'accepted' | 'ignored') {
    busy = true;
    error = '';
    try {
      await change(`conflicts/${conflict.id}`, { decision });
      selected = null;
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="stack">
  {#if error}<div class="notice error" role="alert">{error}</div>{/if}
  {#each conflicts as conflict}<article class="panel stack">
      <div class="spread">
        <div>
          <a href={conflict.mediaId ? `/${conflict.kind==='album'||conflict.kind==='track'?'music/work':conflict.kind==='game'?'games':'media'}/${conflict.mediaId}` : '/lists'}
            ><h3>{conflict.title}</h3></a
          >
          <p class="small">
            {displayLabel(conflict.source)} · {new Date(conflict.occurredAt).toLocaleString()}
          </p>
        </div>
        <span class="badge">{displayLabel(conflict.action)}</span>
      </div>
      <p>{conflict.reason ?? 'This imported change conflicts with your Coast tracking.'}</p>
      {#if conflict.localValue && conflict.remoteValue}
        <p class="small">
          Coast: {describe(conflict.localValue)}<br />{displayLabel(conflict.source)}: {describe(
            conflict.remoteValue
          )}
        </p>
      {/if}
      {#if conflict.positionSeconds !== null}<p class="small">
          Imported progress: {Math.floor(conflict.positionSeconds / 60)} minutes
        </p>{/if}
      <div class="row">
        <Button variant="secondary" disabled={busy} onclick={() => resolve(conflict, 'ignored')}
          >Use Coast everywhere</Button
        ><Button variant="ghost" disabled={busy} onclick={() => (selected = conflict)}
          >Use {displayLabel(conflict.source)} everywhere</Button
        >
      </div>
    </article>{/each}
  {#if !conflicts.length}<p class="small">No imported changes need review.</p>{/if}
</div>
<Dialog
  open={!!selected}
  onclose={() => (selected = null)}
  title="Use this service’s value everywhere?"
  ><div class="stack">
    <p>{selected?.reason}</p>
    <p>
      Apply the {displayLabel(selected?.action ?? '')} change from {displayLabel(
        selected?.source ?? ''
      )} to {selected?.title}. Coast keeps the original import and your decision in history. This
      choice replaces the matching values on other enabled services.
    </p>
    <div class="row">
      <Button
        variant="danger"
        disabled={busy}
        onclick={() => selected && resolve(selected, 'accepted')}
        >Use {displayLabel(selected?.source ?? '')} everywhere</Button
      ><Button variant="secondary" onclick={() => (selected = null)}>Cancel</Button>
    </div>
  </div></Dialog
>
