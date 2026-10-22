import {surfaceEnabled, type MediumFeatures} from './experimental';
import type {LibrarySurface} from './library';

export const actionValues = ['watch','listen','play','read'] as const;
export const actionLabels = {watch:'Watch',listen:'Listen',play:'Play',read:'Read'} as const;
export const actionCategories = {watch:'screen',listen:'music',play:'game',read:'reading'} as const;
export const actionRoutes = ['/for-you','/library','/discover','/search'];
export function actionOptions(config:MediumFeatures) {
  return actionValues.filter(value=>surfaceEnabled(config,value)).map(value=>({value,label:actionLabels[value]}));
}
/** Explicit links win over the account default; withdrawn actions never admit work. */
export function resolveAction(parameters:Pick<URLSearchParams,'get'>, saved:LibrarySurface|undefined, config:MediumFeatures):LibrarySurface {
  const kind=parameters.get('type')??parameters.get('kind');
  const inferred=kind&&['movie','show','season','episode','collection'].includes(kind)?'watch':kind&&['album','artist','track','playlist'].includes(kind)?'listen':kind==='game'?'play':kind&&['book','comic','series'].includes(kind)?'read':undefined;
  const category=parameters.get('category');
  const requested=parameters.get('view') ?? parameters.get('surface') ?? inferred ?? (category&&category!=='all'?actionFromCategory(category):undefined);
  const options=actionOptions(config);
  return options.find(option=>option.value===requested)?.value
    ?? options.find(option=>option.value===saved)?.value ?? options[0]?.value ?? 'watch';
}
export function actionHref(pathname:string, action:LibrarySurface, query='') {
  const route=actionRoutes.includes(pathname)?pathname:'/for-you';
  return route+'?'+new URLSearchParams({view:action,...(route==='/search'&&query?{q:query}:{})});
}
export function actionFromCategory(category:string):LibrarySurface {
  return category==='music'?'listen':category==='game'?'play':category==='reading'?'read':'watch';
}

/** Withdrawn actions discard their filters before a fallback route admits work. */
export function actionUrl(url:URL,saved:LibrarySurface|undefined,config:MediumFeatures) {
  const action=resolveAction(url.searchParams,saved,config);
  const explicit=url.searchParams.get('view')??url.searchParams.get('surface');
  return explicit&&actionValues.some(value=>value===explicit)&&explicit!==action
    ?new URL(actionHref(url.pathname,action,url.searchParams.get('q')??''),url):url;
}
