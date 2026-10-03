import * as v from 'valibot';
export const collectionCategories = [{ value: 'screen', label: 'Watch' }, { value: 'game', label: 'Play' }, { value: 'music', label: 'Listen' }] as const;
export const collectionRules = [
  { value: 'watchlist', label: 'Saved for later' }, { value: 'favourite', label: 'Favourites' },
  { value: 'rating', label: 'Rated items' }, { value: 'list', label: 'Items in lists' },
  { value: 'queue', label: 'Queued items' }, { value: 'active', label: 'In progress' },
  { value: 'history', label: 'Completed activity' }, { value: 'dropped', label: 'Include dropped items' },
] as const;
export type CollectionRule = typeof collectionRules[number]['value'];
export type CollectionPreferences = Record<typeof collectionCategories[number]['value'], Record<CollectionRule, boolean>>;
const rulesSchema = v.object(Object.fromEntries(collectionRules.map(rule => [rule.value, v.boolean()])) as Record<CollectionRule, ReturnType<typeof v.boolean>>);
export const collectionPreferencesSchema = v.object({ screen: rulesSchema, game: rulesSchema, music: rulesSchema });
export function collectionPreferences(input?: Partial<CollectionPreferences>): CollectionPreferences {
  return Object.fromEntries(collectionCategories.map(category => [category.value,
    Object.fromEntries(collectionRules.map(rule => [rule.value, input?.[category.value]?.[rule.value] ?? rule.value !== 'dropped']))])) as CollectionPreferences;
}
