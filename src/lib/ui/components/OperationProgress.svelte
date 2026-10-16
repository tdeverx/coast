<script lang="ts">
  let {label,processed,total}:{label:string;processed:number;total:number|null}=$props();
  const known=$derived(total!==null && Number.isFinite(total) && total>=0);
</script>
<progress aria-label={label} aria-valuetext={known ? `${processed.toLocaleString()} of ${total!.toLocaleString()}` : `${processed.toLocaleString()} items processed; total unknown`} max={known?Math.max(1,total!):1} value={known?Math.min(Math.max(0,processed),total!):undefined}></progress>
<style>
  progress {width:100%;height:6px;border:0;border-radius:99px;overflow:hidden;accent-color:var(--ink);}
  progress:indeterminate {background:linear-gradient(90deg,var(--line) 25%,var(--muted) 50%,var(--line) 75%);background-size:200% 100%;animation:scan-pending 1.8s linear infinite;}
  progress:indeterminate::-webkit-progress-bar {background:transparent;}
  @keyframes scan-pending {to {background-position:-200% 0;}}
  @media(prefers-reduced-motion:reduce) {progress:indeterminate {animation:none;}}
  progress::-webkit-progress-bar {background:var(--line);border-radius:99px;}
  progress::-webkit-progress-value {background:var(--ink);border-radius:99px;}
  progress::-moz-progress-bar {background:var(--ink);border-radius:99px;}
</style>
