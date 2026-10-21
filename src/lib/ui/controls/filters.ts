import type {IconName} from '#lib/ui/components/Icon.svelte';
export type FilterGroup = {
  label: string;
  icon?:IconName;
  value: string;
  options: {value: string; label: string}[];
  change: (value: string) => void;
};

/** Shared row menu vocabulary uses the same icon set as work and profile menus. */
export function filterGroupIcon(label:string):IconName{
  return /sort|order/i.test(label)?'list':/genre|type|media|kind/i.test(label)?'film'
    :/source|provider|server/i.test(label)?'server':/availability|available/i.test(label)?'check'
    :/relationship|collection/i.test(label)?'collection':/friend|audience|people/i.test(label)?'friends'
    :/status|activity|state|date|period|repeat/i.test(label)?'clock':/reason|mode/i.test(label)?'discover':'filter';
}
