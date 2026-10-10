import type { IconName } from '../components/Icon.svelte';
import type { Relationship } from '../relationships';

/** Domain actions supply props; Button owns all rendering and interaction. */
export function relationshipControls(items: { kind: Relationship; value: boolean; label: string; icon: IconName; showCheckmark?: boolean }[], onchange: (kind: Relationship) => void, disabled = false) {
  return items.map(action => ({ item: true as const, text: action.label, icon: action.icon,
    checked: action.value, showCheckmark: action.showCheckmark ?? true, disabled,
    onclick: () => onchange(action.kind) }));
}
export function listMembershipControls<T extends { id: string; name: string; playlist: boolean }>(lists: T[], member: (list: T) => boolean, onchange: (list: T) => void, disabled = false, playlistLabel = 'Add to', playlistIcon: 'plus' | 'list' = 'plus') {
  return lists.map(list => ({ item: true as const, text: list.playlist ? `${playlistLabel} ${list.name}` : list.name,
    icon: list.playlist ? playlistIcon : 'list' as const,
    checked: list.playlist ? undefined : member(list), disabled, onclick: () => onchange(list) }));
}
export function availabilityControl(value: boolean, onchange: (value: boolean) => void, label = 'Available to play only') {
  return { compact: true, icon: 'play' as const, pressed: value, label,
    title: value ? 'Available titles · Show all titles' : 'All titles · Show available only', onclick: () => onchange(!value) };
}

export function collectionControl(value: boolean, onchange: (value: boolean) => void) {
  return { compact: true, icon: 'collection' as const, pressed: value, label: 'In my Collection only',
    title: value ? 'My Collection · Show library titles' : 'Library titles · Show my Collection only', onclick: () => onchange(!value) };
}
