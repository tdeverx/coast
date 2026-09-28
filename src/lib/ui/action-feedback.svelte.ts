import { message } from './client';

type ActionNotice = { text: string; undo?: () => Promise<void>; busy: boolean; error: string };
export const actionFeedback = $state<{ current: ActionNotice | null }>({ current: null });
export function notifyAction(text: string, undo?: () => Promise<void>) {
  actionFeedback.current = { text, undo, busy: false, error: '' };
}
export async function undoAction() {
  const notice = actionFeedback.current;
  if (!notice?.undo || notice.busy) return;
  notice.busy = true;
  try {
    await notice.undo();
    if (actionFeedback.current === notice) notifyAction('Change undone.');
  } catch (cause) {
    notice.error = message(cause);
  } finally {
    notice.busy = false;
  }
}
