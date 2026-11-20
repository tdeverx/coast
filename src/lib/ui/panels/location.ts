import { goto } from '$app/navigation';
import { page } from '$app/state';
import { panelAddress } from '#lib/media/detail-target.js';

export const friendViews = ['accepted', 'pending', 'party', 'invites'] as const;
export const streamViews = ['now', 'history', 'links'] as const;

export function linkedPanelView<T extends string>(url: { searchParams: Pick<URLSearchParams, 'get'> }, allowed: readonly T[]) {
  const view = url.searchParams.get('panelView');
  return allowed.find(value => value === view);
}

export function selectPanelView(panel: 'friends' | 'streams' | 'notifications', view: string) {
  const url = new URL(panelAddress(page).href);
  if (url.searchParams.get(panel) !== 'true' || url.searchParams.get('panelView') === view) return;
  url.searchParams.set('panelView', view);
  void goto(url, { shallow: true, reset: false, replace: true, state: { ...page.state } });
}
