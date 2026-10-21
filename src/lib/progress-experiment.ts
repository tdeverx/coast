import * as v from 'valibot';
import type {ShelfItem} from './ui/shelves/types';

export const progressExperimentTabs = [
  {value:'continue',label:'Continue'}, {value:'next',label:'Next'}, {value:'watchlist',label:'Later'}, {value:'favourites',label:'Favourites'},
];
export const profileProgressExperimentTabs=[...progressExperimentTabs.filter(tab=>tab.value==='continue'||tab.value==='next'),{value:'finished',label:'Finished'},{value:'dropped',label:'Dropped'}];
export const progressExperimentSchema = v.object({
  view:v.optional(v.picklist(['continue','next','watchlist','favourites','finished','dropped']),'continue'),
  kind:v.optional(v.picklist(['all','movie','show','game','book','comic']),'all'),
  scope:v.optional(v.picklist(['all','available']),'all'),
  page:v.optional(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(1_000_000)),1),
});
export type ProgressExperimentOptions = v.InferOutput<typeof progressExperimentSchema>;
export type ProgressExperimentContent = ProgressExperimentOptions & {items:ShelfItem[];total:number;pages:number};
export function progressExperimentParameters(url:URL) {
  return {view:url.searchParams.get('view')??undefined,kind:url.searchParams.get('kind')??undefined,
    scope:url.searchParams.get('scope')??undefined,page:url.searchParams.has('page')?Number(url.searchParams.get('page')):undefined};
}
