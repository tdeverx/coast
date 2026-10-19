import type {ShelfConfig} from './shelves';
import {dynamicKind} from '$lib/recommendations/model';
import type {ProgressOptions} from '$lib/progress';
import {validPageInterval} from '$lib/page-window';
/** Only linked row destinations; ordinary navigation to these pages stays unchanged. */
export function sectionTarget(href:string,base:URL):({href:string;source:ShelfConfig}|{href:string;profile:{username:string;section:'insights'|'favourites';period:'all'|'month'|'year';kind:string;scope:string}})|null{
 let url:URL;try{url=new URL(href,base);}catch{return null;}
 if(url.origin!==base.origin||!['http:','https:'].includes(url.protocol)||url.href.includes('#')||url.username||url.password||url.href.length>2048)return null;
 const p=url.searchParams,get=(key:string,fallback='')=>p.get(key)??fallback;
 if([...p.keys()].some(key=>p.getAll(key).length!==1)||p.has('action'))return null;
 let source:ShelfConfig|undefined;
 if(url.pathname==='/progress'){
  const view=get('view','watching');if(!['watching','up-next','next','recommendations','watchlist','favourites','finished','dropped'].includes(view))return null;
  const category=get('category','screen'),kind=get('kind','all'),scope=get('scope','all');
  if(!['screen','game','music','reading'].includes(category)||!['all','movie','show','book','comic'].includes(kind)||!['all','available'].includes(scope))return null;
  source={type:'progress',layout:'grid',surface:['next','recommendations','watchlist','favourites'].includes(view)?view as 'next'|'recommendations'|'watchlist'|'favourites':p.has('username')||['finished','dropped'].includes(view)?'profile':'continue',username:get('username')||undefined,mediums:!p.has('username'),filters:{view,category,kind,scope,page:1} as ProgressOptions};
 }else if(['/library','/music','/games'].includes(url.pathname)){
  const surface=url.pathname==='/music'?'listen':url.pathname==='/games'?'play':get('view','watch');
  if(!['watch','listen','play','read'].includes(surface))return null;
  const lastPage=Number(get('page','1')),firstPage=Number(get('firstPage',String(lastPage)));
  if(!validPageInterval(firstPage,lastPage))return null;
  const kind=get('kind','all'),activity=get('activity','all');
  const selection=get('tracking',surface==='listen'?kind:get('state',surface==='watch'?activity==='completed'?'watched':activity==='active'?'progress':activity:activity));
  source={type:'library',layout:'grid',surface:surface as 'watch'|'listen'|'play'|'read',initialPage:lastPage,initialFirstPage:p.has('firstPage')?firstPage:undefined,collection:get('collection')==='true'||get('personal')==='true',username:get('username'),genre:get('genre'),initialSelection:selection,initialKind:(['movie','show','book','comic'].includes(kind)?kind:'all') as 'all'|'movie'|'show'|'book'|'comic',initialScope:get('scope',get('availability'))==='available'?'available':'all',initialRelationship:get('relationship','all'),initialSource:get('source','all'),initialAvailability:get('availability','all')};
 }else if(url.pathname==='/for-you'){
  const section=get('section'),category=get('category','screen');
  if(!['screen','game','music','reading'].includes(category))return null;
  if(['activity','popular'].includes(section))source={type:'social',surface:section==='popular'?'popular':'activity',category,mediums:true,layout:'grid'};
  else if(['upcoming','recommendations','dynamic'].includes(section)){
   const kind=dynamicKind(p.get('kind')),reason=get('reason');
   source={type:'for-you',feature:section==='dynamic'?'row':section as 'upcoming'|'recommendations',layout:'grid',category:category as 'screen'|'game'|'music'|'reading',genre:get('genre')||undefined,workId:get('work')||undefined,seed:get('seed')||undefined,...(kind?{kind}:{}),...(['liked','watched','saved','explore'].includes(reason)?{reason:reason as 'liked'|'watched'|'saved'|'explore'}:{})};
  }
 }else if(url.pathname==='/discover'&&['trending','recent'].includes(get('section'))){
  const surface=get('surface','watch'),kind=get('kind','all');if(!['watch','listen','play','read'].includes(surface)||!['all','book','comic'].includes(kind))return null;
  source={type:'discovery',section:get('section') as 'trending'|'recent',surface:surface as 'watch'|'listen'|'play'|'read',kind:kind as 'all'|'book'|'comic',layout:'grid'};
 }else if(/^\/profile\/[^/]+$/.test(url.pathname)){
  let username:string;try{username=decodeURIComponent(url.pathname.split('/')[2]);}catch{return null;}
  const view=get('section',get('view','overview')),period=get('period','all');
  if(!['all','month','year'].includes(period))return null;
  if(view==='insights'||view==='favourites')return {href:url.pathname+url.search,profile:{username,section:view,period:period as 'all'|'month'|'year',kind:get('kind','all'),scope:get('scope','all')}};
  if(view==='history')source={type:'journal',layout:'grid',today:new Date().toISOString().slice(0,10),filters:{username,period,activityKind:get('type','all'),query:get('q'),genre:get('genre')||undefined,repeats:get('repeats')==='true',from:get('from')||undefined,to:get('to')||undefined}};
 }else if(url.pathname==='/lists'&&(/^[a-f0-9-]{36}$/i.test(get('view'))||['watchlist','favourites'].includes(get('view')))){
  source={type:'list',view:get('view'),title:get('view')==='watchlist'?'Watchlist':get('view')==='favourites'?'Favourites':'List',custom:!['watchlist','favourites'].includes(get('view')),layout:'grid',filters:{kind:get('kind','all'),scope:get('scope','all')}};
 }
 return source?{href:url.pathname+url.search,source}:null;
}
