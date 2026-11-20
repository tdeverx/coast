import {actionCategories,actionValues} from '#lib/actions.js';
import {librarySegmentValues,librarySortValues,type LibrarySegment,type LibrarySort} from '#lib/library.js';
import {progressExperimentParameters,progressExperimentSchema} from '#lib/progress-experiment.js';
import * as v from 'valibot';
import type {ShelfConfig} from './shelves';
import {recommendationSectionSource} from '#lib/recommendations/section.js';
import type {DynamicMedium} from '#lib/recommendations/model.js';
import {progressSurface,type ProgressOptions} from '#lib/progress.js';
import {validPageInterval} from '#lib/page-window.js';
import {activityFiltersSchema} from '#lib/social/model.js';
/** Only linked row destinations; ordinary navigation to these pages stays unchanged. */
export function sectionTarget(href:string,base:Pick<URL,'href'|'origin'>):{href:string;source:ShelfConfig}|null{
 let url:URL;try{url=new URL(href,base.href);}catch{return null;}
 if(url.origin!==base.origin||!['http:','https:'].includes(url.protocol)||url.href.includes('#')||url.username||url.password||url.href.length>2048)return null;
 const p=url.searchParams,get=(key:string,fallback='')=>p.get(key)??fallback;
 if([...p.keys()].some(key=>p.getAll(key).length!==1)||p.has('action'))return null;
 let source:ShelfConfig|undefined;
 if(url.pathname==='/progress-experiment'){
  const filters=v.safeParse(progressExperimentSchema,progressExperimentParameters(url));
  if(!filters.success)return null;
  source={type:'progress-experiment',layout:'grid',category:filters.output.category,filters:filters.output,username:get('username')||undefined};
 }else if(url.pathname==='/progress'){
  const view=get('view','watching');if(!['watching','up-next','next','recommendations','watchlist','favourites','paused','finished','dropped'].includes(view))return null;
  const category=get('category','screen'),kind=get('kind','all'),scope=get('scope','all');
  if(!['screen','game','music','reading'].includes(category)||!['all','movie','show','book','comic'].includes(kind)||!['all','available'].includes(scope))return null;
  source={type:'progress',layout:'grid',actionScoped:get('scoped')==='true',category:get('scoped')==='true'?category as ProgressOptions['category']:undefined,surface:progressSurface(view,p.has('username')),username:get('username')||undefined,mediums:!p.has('username')&&get('scoped')!=='true',filters:{view,category,kind,scope,page:1} as ProgressOptions};
 }else if(['/library','/music','/games'].includes(url.pathname)){
  const surface=url.pathname==='/music'?'listen':url.pathname==='/games'?'play':get('view','watch');
  if(!['watch','listen','play','read'].includes(surface))return null;
  const lastPage=Number(get('page','1')),firstPage=Number(get('firstPage',String(lastPage)));
  if(!validPageInterval(firstPage,lastPage))return null;
  const kind=get('kind','all'),activity=get('activity','all'),segment=get('segment','all'),sort=get('sort','default');
  if(!librarySegmentValues.includes(segment as LibrarySegment)||!librarySortValues.includes(sort as LibrarySort))return null;
  const selection=get('tracking',surface==='listen'?kind:get('state',surface==='watch'?activity==='completed'?'watched':activity==='active'?'progress':activity:activity));
  source={type:'library',layout:'grid',initialSort:sort as LibrarySort,initialSegment:segment as LibrarySegment,segments:url.pathname==='/library',surface:surface as 'watch'|'listen'|'play'|'read',initialPage:lastPage,initialFirstPage:p.has('firstPage')?firstPage:undefined,collection:get('collection')==='true'||get('personal')==='true',username:get('username'),genre:get('genre'),initialSelection:selection,entitySegments:url.pathname==='/library',countHeading:url.pathname==='/library',initialKind:(['movie','show','collection','book','comic','series'].includes(kind)?kind:'all') as import('#lib/library.js').LibraryKind,initialScope:get('scope',get('availability'))==='available'?'available':'all',initialRelationship:get('relationship','all'),initialSource:get('source','all'),initialAvailability:get('availability','all')};
 }else if(url.pathname==='/for-you'){
  const action=actionValues.find(action=>action===get('view'));
  if(p.has('view')&&!action)return null;
  const section=get('section'),category=action?actionCategories[action]:get('category','screen');
  if(!['screen','game','music','reading'].includes(category))return null;
  if(section==='recent'&&['all','movie','show','music','game','book','comic'].includes(get('kind',action?'all':'movie')))source={type:'library-feed',feature:'recent',action,layout:'grid',kind:get('kind',action?'all':'movie')};
  else if(section==='requests'&&(!action||action==='watch')&&['all','movie','show'].includes(get('kind','all'))&&['available','pending','approved','processing','declined'].includes(get('state','available')))source={type:'library-feed',feature:'requests',layout:'grid',kind:get('kind','all'),state:get('state','available')};
  else if(['activity','popular'].includes(section)){
   const filters=v.safeParse(activityFiltersSchema,Object.fromEntries(p));if(section==='activity'&&!filters.success)return null;
   source={type:'social',surface:section==='popular'?'popular':'activity',category,mediums:section==='activity'||!action,layout:'grid',...(section==='activity'&&filters.success?filters.output:{})};
  }
  else source=recommendationSectionSource(url,category as DynamicMedium,'personal');
 }else if(url.pathname==='/discover'){
  const surface=actionValues.find(value=>value===get('view',get('surface','watch')));
  if(!surface)return null;
  const section=get('section'),kind=get('kind','all');
  if((section==='trending'||section==='recent')&&['all','book','comic'].includes(kind))
   source={type:'discovery',scoped:p.has('view'),section,surface,kind:kind as 'all'|'book'|'comic',layout:'grid'};
  else source=recommendationSectionSource(url,actionCategories[surface],'generic');
 }else if(/^\/profile\/[^/]+\/?$/.test(url.pathname)){
  let username:string;try{username=decodeURIComponent(url.pathname.split('/')[2]);}catch{return null;}
  const view=get('section');
  if(view==='progress'){
   const filters=v.safeParse(progressExperimentSchema,progressExperimentParameters(url));
   if(!filters.success||!filters.output.category)return null;
   const category=filters.output.category;
   const title=category==='game'?'Playing':category==='reading'?'Reading':'Watching';
   source={type:'progress-experiment',layout:'grid',category,filters:filters.output,username,title,profile:true};
  }else if(view==='list'){
   const list=get('list');
   if(!/^[a-f0-9-]{36}$/i.test(list)&&!['watchlist','favourites'].includes(list))return null;
   const number=Number(get('page','1'));
   if(!validPageInterval(number,number))return null;
   source={type:'list',view:list,title:list==='watchlist'?'Watchlist':list==='favourites'?'Favourites':'List',
    custom:!['watchlist','favourites'].includes(list),layout:'grid',filters:{kind:get('kind','all'),scope:get('scope','all')},profile:username,page:number};
  }
 }else if(url.pathname==='/lists'&&(/^[a-f0-9-]{36}$/i.test(get('view'))||['watchlist','favourites'].includes(get('view')))){
  source={type:'list',view:get('view'),title:get('view')==='watchlist'?'Watchlist':get('view')==='favourites'?'Favourites':'List',custom:!['watchlist','favourites'].includes(get('view')),layout:'grid',filters:{kind:get('kind','all'),scope:get('scope','all')}};
 }
 return source?{href:url.pathname+url.search,source}:null;
}
