import type {IconName} from '#lib/ui/components/Icon.svelte';
export type FilterSection = 'content' | 'access' | 'activity' | 'order';
export type FilterReset = { disabled: boolean; run: () => unknown };
export type FilterGroup = {
  label: string;
  section?: FilterSection;
  icon?:IconName;
  presentation?: 'checkbox';
  value: string;
  options: {value: string; label: string}[];
  change: (value: string) => void;
};

/** Stable source-owned sections, with no empty group dividers or extra headings. */
export function filterSections(groups: readonly FilterGroup[]) {
  return (['content', 'access', 'activity', 'order'] as const)
    .map(section => groups.filter(group => (group.section ?? 'content') === section))
    .filter(section => section.length);
}

/** Explicit owners reset together; the renderer never invents a default option. */
export function combineFilterResets(...owners: (FilterReset | undefined)[]): FilterReset | undefined {
  const resets = owners.filter((owner): owner is FilterReset => !!owner);
  return resets.length ? { disabled: resets.every(owner => owner.disabled),
    run: () => Promise.all(resets.filter(owner => !owner.disabled).map(owner => owner.run())) } : undefined;
}

/** Shared row menu vocabulary uses the same icon set as work and profile menus. */
export function filterGroupIcon(label:string):IconName{
  return /sort|order/i.test(label)?'list':/genre|type|media|kind/i.test(label)?'film'
    :/source|provider|server/i.test(label)?'server':/availability|available|owned/i.test(label)?'check'
    :/relationship|collection/i.test(label)?'collection':/friend|audience|people/i.test(label)?'friends'
    :/status|activity|state|date|period|repeat/i.test(label)?'clock':/reason|mode/i.test(label)?'discover':'filter';
}
