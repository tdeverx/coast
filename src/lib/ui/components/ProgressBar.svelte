<script lang="ts">
 let {progress,label='Playback progress'}:{progress:number;label?:string}=$props();
 const percentage=$derived(Math.max(0,Math.min(1,Number.isFinite(progress)?progress:0))*100);
</script>
<div class="progress-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percentage)}>
 <span style:width={`${percentage}%`}></span>
</div>
<style>
 .progress-bar{height:100%;border-radius:99px;overflow:hidden;background:var(--progress-track-background,color-mix(in srgb,var(--white) calc(69 / 255 * 100%),transparent));pointer-events:none;}
 span{display:block;height:100%;border-radius:inherit;background:var(--progress-fill-background,currentColor);}
</style>
