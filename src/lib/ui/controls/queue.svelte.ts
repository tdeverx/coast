import { useClient } from '../client-context';
import { notifyAction } from '../action-feedback.svelte';
import { message } from '../client';
/** Independently guard each queue entry; failures do not block unrelated retries. */
export function createQueueActions() {
  const { change } = useClient();
  let pending = $state<string[]>([]), error = $state('');
  return {
    get error() { return error; },
    busy(id: string) { return pending.includes(id); },
    async run(id: string, action: 'retry' | 'cancel' | 'promote') {
      if (pending.includes(id)) return false;
      pending = [...pending, id]; error = '';
      try {
        await change(`queue/${id}/${action}`, {});
        notifyAction(action === 'retry' ? 'Job queued for retry.' : action === 'promote' ? 'Job prioritized. Service cooldowns still apply.' : 'Job cancelled.');
        return true;
      } catch (cause) { error = message(cause); return false; }
      finally { pending = pending.filter(value => value !== id); }
    },
  };
}
