import { onMount } from 'svelte';
let now = $state(Date.now());
let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;
/** Mounted consumers share one timer, released with the last consumer. */
export function useClock() {
  onMount(() => {
    if (users++ === 0) {
      now = Date.now();
      timer = setInterval(() => now = Date.now(), 1000);
    }
    return () => { if (--users === 0) { clearInterval(timer); timer = undefined; } };
  });
  return { get now() { return now; } };
}
