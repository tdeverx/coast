<script lang="ts">
  import {statusLabels,type ActivityStatus} from '#lib/social/status.js';
  let { name, src, label, class: className = '', size = 32, status, border = 'default' }: {
    name: string; src?: string | null; label?: string; class?: string; size?: number; status?:ActivityStatus;
    border?: 'default' | 'none' | 'loading' | 'buffering' | 'ready' | 'error';
  } = $props();
  let failed = $state(false);
  let loaded = $state<string>();
  $effect(() => { src; failed = false; });
</script>
<span class="avatar {className}" class:media-surface-edge={border !== 'none'} data-border={border} style:--avatar-size={`${size}px`}>
  {#if src && !failed}
    {#if loaded !== src}<span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>{/if}
    <img {src} alt={label ?? ''} loading="lazy" decoding="async" style:visibility={loaded === src ? 'visible' : 'hidden'} onload={event => loaded = event.currentTarget.getAttribute('src') ?? undefined} onerror={() => failed = true} />
  {:else}{name.slice(0, 1).toUpperCase()}{/if}
  {#if status&&status!=='offline'}<span class="status-dot" data-status={status} role="img" aria-label={statusLabels[status]} title={statusLabels[status]}></span>{/if}
</span>
<style>
  .avatar { display:grid; place-items:center; width:var(--avatar-size); height:var(--avatar-size); border-radius:50%; position:relative; isolation:isolate; background:var(--surface); color:var(--ink); font-size:var(--text-sm); }
  .avatar[data-border='ready'] {--avatar-border-color:var(--success);}
  .avatar[data-border='loading'],.avatar[data-border='buffering'] {--avatar-border-color:var(--rating);}
  .avatar[data-border='error'] {--avatar-border-color:var(--danger);}
  .avatar:is([data-border='loading'],[data-border='buffering'],[data-border='ready'],[data-border='error'])::after {border-color:var(--avatar-border-color);mix-blend-mode:normal;opacity:1;}
  .avatar:is([data-border='loading'],[data-border='buffering'])::after {animation:avatar-border-pulse 1.8s ease-in-out infinite;}
  @keyframes avatar-border-pulse {0%,100% {opacity:.35;}50% {opacity:1;}}
  @media(prefers-reduced-motion:reduce) {.avatar:is([data-border='loading'],[data-border='buffering'])::after {animation:none;}}
  .status-dot {position:absolute;z-index:1;right:0;bottom:0;width:clamp(6px,calc(var(--avatar-size) / 4),10px);height:clamp(6px,calc(var(--avatar-size) / 4),10px);box-shadow:0 0 0 2px var(--canvas);}
  img { position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%; }
</style>
