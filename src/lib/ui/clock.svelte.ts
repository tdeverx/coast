import { untrack } from 'svelte';

function createClock(interval: number) {
  let now = $state(Date.now());
  let users = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  function stop() {
    clearInterval(timer);
    timer = undefined;
  }
  function resume() {
    stop();
    if (document.hidden || !users) return;
    now = Date.now();
    timer = setInterval(() => now = Date.now(), interval);
  }
  function subscribe() {
    if (users++ === 0) {
      document.addEventListener('visibilitychange', resume);
      resume();
    }
    return () => {
      if (--users !== 0) return;
      stop();
      document.removeEventListener('visibilitychange', resume);
    };
  }
  return { subscribe, get now() { return now; } };
}
const seconds = createClock(1000);
const minutes = createClock(60000);

/** Visible mounted consumers share precision-specific timers, released with the last consumer. */
export function useClock(precision: 'second' | 'minute' = 'second', enabled: () => boolean = () => true) {
  const clock = precision === 'minute' ? minutes : seconds;
  $effect(() => {
    if (enabled()) return untrack(clock.subscribe);
  });
  return { get now() { return clock.now; } };
}
