<script lang="ts">
  import {statusLabels,type ActivityStatus} from '$lib/social/status';
  let { name, src, label, class: className = '', size = 32, status }: {
    name: string; src?: string | null; label?: string; class?: string; size?: number; status?:ActivityStatus;
  } = $props();
  let failed = $state(false);
  let loaded = $state<string>();
  $effect(() => { src; failed = false; });
</script>
<span class="avatar {className}" style:--avatar-size={`${size}px`}>
  {#if src && !failed}
    {#if loaded !== src}<span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>{/if}
    <img {src} alt={label ?? ''} loading="lazy" decoding="async" style:visibility={loaded === src ? 'visible' : 'hidden'} onload={event => loaded = event.currentTarget.getAttribute('src') ?? undefined} onerror={() => failed = true} />
  {:else}{name.slice(0, 1).toUpperCase()}{/if}
  {#if status&&status!=='offline'}<span class="status-dot" data-status={status} role="img" aria-label={statusLabels[status]} title={statusLabels[status]}></span>{/if}
</span>
<style>
  .avatar { display:grid; place-items:center; width:var(--avatar-size); height:var(--avatar-size); border-radius:50%; position:relative; background:var(--surface); color:var(--ink); font-size:var(--text-sm); }
  .status-dot {position:absolute;right:0;bottom:0;width:clamp(6px,calc(var(--avatar-size) / 4),10px);height:clamp(6px,calc(var(--avatar-size) / 4),10px);box-shadow:0 0 0 2px var(--canvas);}
  img { position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%; }
</style>
