const uuid='[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const local=new RegExp(`^/(media|games|music/work)/(${uuid})/?$`,'i');
const group=new RegExp(`^/media/reading-collection/(${uuid})/?$`,'i');
const game=new RegExp(`^/games/igdb/(${uuid})/([1-9][0-9]{0,14})/?$`,'i');
const music=new RegExp(`^/music/(${uuid})/([a-f0-9]{32}|${uuid})/?$`,'i');
const queries=new Set(['section','insight','source','period','page','playthrough','edition','relationship','credits','rowKind','rowProgress','rowAvailable','type','department','available']);
export type MediaDetailTarget={href:string;section:string|null;page:number;playthrough:string|null;edition:string|null}&(
 |{kind:'work';id:string}
 |{kind:'reading-group';id:string}
 |{kind:'reading-provider';provider:'openlibrary'|'comic-vine';id:string}
 |{kind:'game-provider';instanceId:string;id:string}
 |{kind:'music-source';connectionId:string;id:string}
 |{kind:'person';id:string}
);
/** Only real detail destinations participate; commands, history and other routes keep navigation. */
export function mediaDetailTarget(href:string,base:URL):MediaDetailTarget|null{
 let url:URL;try{url=new URL(href,base);}catch{return null;}
 if(url.origin!==base.origin||!['http:','https:'].includes(url.protocol)||url.href.includes('#')||url.username||url.password||url.href.length>2048)return null;
 if([...url.searchParams.keys()].some(key=>!queries.has(key)||url.searchParams.getAll(key).length!==1))return null;
 const page=Number(url.searchParams.get('page')??1),playthrough=url.searchParams.get('playthrough');
 if(!Number.isInteger(page)||page<1||page>42949673||playthrough&&!new RegExp(`^${uuid}$`,'i').test(playthrough))return null;
 const common={href:url.pathname+url.search,section:url.searchParams.get('section'),page,playthrough,edition:url.searchParams.get('edition')};
 let match=url.pathname.match(local);
 if(match)return {...common,kind:'work',id:match[2]};
 match=url.pathname.match(group);if(match)return {...common,kind:'reading-group',id:match[1]};
 match=url.pathname.match(/^\/media\/(openlibrary|comic-vine)\/(OL[1-9][0-9]{0,19}W|4000-[1-9][0-9]{0,14})\/?$/);
 if(match&&((match[1]==='openlibrary')===match[2].startsWith('OL')))return {...common,kind:'reading-provider',provider:match[1] as 'openlibrary'|'comic-vine',id:match[2]};
 match=url.pathname.match(game);if(match)return {...common,kind:'game-provider',instanceId:match[1],id:match[2]};
 match=url.pathname.match(music);if(match)return {...common,kind:'music-source',connectionId:match[1],id:match[2]};
 match=url.pathname.match(/^\/people\/([1-9][0-9]{0,14})\/?$/);if(match&&Number.isSafeInteger(Number(match[1])))return {...common,kind:'person',id:match[1]};
 return null;
}
