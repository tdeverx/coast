import { message, ApiError } from '$lib/ui/client';
import { useClient } from '$lib/ui/client-context';

/** Episode controls retain conflict acknowledgement independently of row rendering. */
export function createEpisodeTracking() {
  const { change } = useClient();

  let error = $state('');
  let busy = $state(false);
  let confirm = $state(false);
  let warning = $state('');
  let pending = $state<{ id: string; watched: boolean } | null>(null);
  async function watch(id: string, watched: boolean, acknowledged = false) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await change('tracking', {
        mediaId: id,
        action: watched ? 'unwatch' : 'watch',
        acknowledged,
      });
      confirm = false;
      pending = null;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        pending = { id, watched };
        warning = cause.message;
        confirm = true;
      } else error = message(cause);
    } finally {
      busy = false;
    }
  }
  return {
    get error() { return error; },
    get busy() { return busy; },
    get confirm() { return confirm; },
    set confirm(value: boolean) { confirm = value; },
    get warning() { return warning; },
    watch,
    approve: () => pending && watch(pending.id, pending.watched, true),
  };
}
