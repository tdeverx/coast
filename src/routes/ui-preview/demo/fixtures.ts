import type { GameActionState, WorkActionState } from '#lib/media/work-actions.js';
import type {MenuConditions} from '#lib/ui/controls/menu-preview.js';
import type {NotificationEntry} from '#lib/notifications/model.js';
import type { MediaView, MediaCardPresentation } from '#lib/ui/types.js';
import type { JournalEntry } from '#lib/profile/journal.js';
import type { MusicItem } from '#lib/music/model.js';
import type { MediaActionData } from '#lib/media/actions.js';
import { providerSchedule } from '#lib/providers/schedule.js';
export const id='00000000-0000-4000-8000-000000000074';
export const today='2026-10-01';
const previewSubtitleUrl = 'data:text/vtt,WEBVTT%0A%0A00%3A00%3A00.000%20--%3E%2000%3A00%3A04.000%0APreview%20subtitle';
export const previewSubtitleTracks = [
  { index: 3, label: 'English', language: 'eng', url: previewSubtitleUrl },
  { index: 4, label: 'French', language: 'fre', url: `${previewSubtitleUrl}%20(en%20français)` },
];
export const movie:MediaView={id,kind:'movie',title:'Preview title',overview:'Demo content for comparing the existing components. Nothing in this preview is saved.',year:2026,genres:['Drama','Adventure'],runtimeMinutes:110,available:false,progress:1800,duration:6600,watched:false,playCount:0,watchlist:true,favourite:false,collected:true,dropped:false,rating:4,poster:'/coast-mark.png',backdrop:'/coast-mark.png'};
export const show:MediaView={...movie,id:'00000000-0000-4000-8000-000000000075',kind:'show',title:'Preview series',progress:0,totalEpisodes:8,completedEpisodes:3};
export const episode:MediaView={...movie,id:'00000000-0000-4000-8000-000000000076',kind:'episode',title:'A first chapter',runtimeMinutes:45,releaseDate:today,showId:show.id,seasonNumber:1,episodeNumber:1};
export const items=[movie,show];
export const facts=[{label:'Released',value:'2026'},{label:'Duration',value:'1h 50m'},{label:'Genres',value:'Drama · Adventure'}];
export const chart=[{label:'Movies',value:8},{label:'Episodes',value:14},{label:'Other',value:3}];
export const days=[{date:'2026-09-28',movies:2,episodes:3},{date:'2026-09-29',movies:1,episodes:4},{date:today,movies:1,episodes:2}];
export const journal:JournalEntry[]=[{...movie,eventId:id,watchedAt:today+'T18:00:00Z',source:'manual',rewatched:false},{...episode,eventId:episode.id,watchedAt:today+'T19:00:00Z',source:'manual',rewatched:true}];
export const content={items,page:1,pages:1,total:2};
export const provider={id,name:'Preview Jellyfin',provider:'jellyfin',enabled:true,connectedAccounts:1,accounts:[{id,username:'preview'}],schedule:providerSchedule('jellyfin'),baseUrl:'http://preview.invalid',allowPrivateNetwork:false,linkedMediaInstanceId:null};
export const job={id,kind:'jellyfin.sync',state:'pending',attempts:0,lastError:null,connectionLabel:'Preview account',progress:{processed:12,total:40,phase:'User access'}};
export const music:MusicItem={id,kind:'album',title:'Preview album',artists:[{id,name:'Preview artist'}],albumArtists:[{id,name:'Preview artist'}],artistNames:['Preview artist'],genres:['Ambient'],year:2026,overview:'An album preview with ordered tracks.',externalIds:{},artworkUrl:'/coast-mark.png'};
export const track:MusicItem={...music,id:episode.id,kind:'track',title:'Preview track',durationSeconds:240,trackNumber:1,album:music.title,albumId:id};
export const actionData:MediaActionData={item:movie,wholeWork:movie,releaseDate:'2026-01-01',hasReleaseDate:true,progressTargetIds:[id],hasPersonalOverrides:false,activeCheckinId:null,ownRewatchStartedAt:null,rewatchTargetIds:[id],targets:[movie],requestTarget:movie,requestsEnabled:false,refreshTarget:null,playable:null,editions:[],requests:[]};
function previewMediaTargets(item:MediaView,conditions:MenuConditions){
  const requestTarget=item.kind==='episode'||item.kind==='season'?{...show,tmdbId:'1234'}:['show','movie'].includes(item.kind)?item:null;
  const refreshTarget=conditions.metadataSource===false?null:[item,requestTarget].find(target=>target?.tmdbId&&['show','movie','collection'].includes(target.kind))??null;
  return {requestTarget,refreshTarget};
}

export function menuPreviewJob(conditions: MenuConditions): import('#lib/ui/queue.js').QueueAction {
  const remedy=conditions.connectionFailure?'connection':conditions.permissionFailure?'permissions':conditions.metadataFailure?'metadata':null;
  return {...job,kind:conditions.benchmark?'benchmark.run':job.kind,state:conditions.jobFailed?'failed':conditions.jobRunning?'running':'pending',
    lastError:remedy?'Preview service needs attention.':null,
    failure:remedy?{code:'preview',remedy,retryable:false}:null};
}

/** Exercise the same menu owners with representative, isolated work identities. */
export function menuPreviewItem(scenario: string, conditions: MenuConditions = {}): MediaView | MediaCardPresentation {
  let item: MediaView | MediaCardPresentation;
  switch (scenario) {
    case 'episode': item = { ...episode, available: true }; break;
    case 'show': item = { ...show, available: true }; break;
    case 'season': item = { ...show, id: '00000000-0000-4000-8000-000000000078', kind: 'season', showId: show.id,
      seasonNumber: 1, title: 'Season 1', available: true }; break;
    case 'collection': item = { ...movie, id: '00000000-0000-4000-8000-000000000079', kind: 'collection', title: 'Preview box set', available: true }; break;
    case 'book':
    case 'comic':
    case 'game':
    case 'track':
    case 'album':
    case 'artist': {
      const number = ['book', 'comic', 'game', 'track', 'album', 'artist'].indexOf(scenario) + 81;
      const workId = `00000000-0000-4000-8000-0000000000${number}`;
      item = { id: workId, ...(scenario === 'artist' ? { connectionId: id, artistId: workId, workId } : { workId }), kind: scenario,
        href: '#', title: `Preview ${scenario}`, available: true, poster: movie.poster, ...(scenario==='track'?{positionSeconds:conditions.position===false?0:45}:{}) };
      break;
    }
    case 'pending': item = { ...movie, playbackPending: true }; break;
    case 'list-entry': item = { ...movie, available: true, listContext: { listId: show.id, entryId: episode.id } }; break;
    default: item = { ...movie, available: true };
  }
  item = { ...item, available: conditions.available ?? !!item.available };
  if (!('href' in item)) {
    item = {
      ...item,
      playbackPending: conditions.pending ?? item.playbackPending,
      progress: conditions.position === false ? 0 : item.progress,
      rewatchStartedAt: conditions.rewatch ? today + 'T12:00:00Z' : null,
      status: conditions.paused ? 'paused' : item.status,
      tmdbId: '1234',
    };
  }
  return item;
}

const notificationExamples:NotificationEntry[]=[
 {id:'00000000-0000-4000-8000-000000000001',kind:'recommendation',title:'Recommended something to you',body:null,actor:{username:'Alice',avatar:null,status:'online'},media:{card:movie,id,title:movie.title,href:`/media/${id}`,artwork:movie.backdrop??movie.poster??null,availability:'available',stale:false},createdAt:today,readAt:null,locked:false,sourceLabel:null,destination:null,requestState:null,sessionState:null,actions:['save','dismiss'],subjectId:id},
 {id:'00000000-0000-4000-8000-000000000006',kind:'synced-invite',title:'Join a synced session',body:null,actor:{username:'Alice',avatar:null,status:'online'},media:{card:movie,id,title:movie.title,href:`/media/${id}`,artwork:movie.backdrop??movie.poster??null,availability:'available',stale:false},createdAt:today,readAt:null,locked:false,sourceLabel:null,destination:`/synced/${id}`,requestState:null,sessionState:'Playing',actions:['decline'],subjectId:id},
 {id:'00000000-0000-4000-8000-000000000002',kind:'friend-request',title:'Wants to be friends',body:null,actor:{username:'Sam',avatar:null,status:'away'},media:null,createdAt:today,readAt:null,locked:false,sourceLabel:null,destination:'/for-you?friends=true',requestState:null,sessionState:null,actions:['accept','decline'],subjectId:id},
 {id:'00000000-0000-4000-8000-000000000003',kind:'request',title:'Your requested title is available',body:'Ready to watch from your connected library.',actor:null,media:{card:movie,id,title:movie.title,href:`/media/${id}`,artwork:movie.backdrop??movie.poster??null,availability:'available',stale:false},createdAt:today,readAt:null,locked:false,sourceLabel:null,destination:`/media/${id}`,requestState:'available',sessionState:null,actions:[],subjectId:id},
 {id:'00000000-0000-4000-8000-000000000004',kind:'external-action',title:'A connected service needs attention',body:'Reconnect this account to resume synchronization.',actor:null,media:null,createdAt:today,readAt:null,locked:false,sourceLabel:'Jellyfin · User synchronization',destination:'/settings/jobs',requestState:null,sessionState:null,actions:[],subjectId:null},
 {id:'00000000-0000-4000-8000-000000000005',kind:'reaction',title:'Reacted ❤️ to your activity',body:null,actor:{username:'Taylor',avatar:null,status:'busy'},media:{card:movie,id,title:movie.title,href:`/media/${id}`,artwork:movie.backdrop??movie.poster??null,availability:'available',stale:false},createdAt:today,readAt:null,locked:false,sourceLabel:null,destination:'/for-you?section=activity',requestState:null,sessionState:null,actions:[],subjectId:id}
];
/** Synthetic transport is injected only into preview descendants. */
export const fixtureFetch: import('#lib/ui/client.js').ApiTransport = async (input, init) => {
    const url=new URL(input instanceof Request?input.url:String(input),'http://preview.invalid');
    if(!url.pathname.startsWith('/api/'))return new Response('Preview only', {status:409});
    const method=(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    if(url.pathname.endsWith('/providers/streams/refresh')&&method==='POST')return Response.json({queued:1});
    if(method!=='GET')return Response.json({error:'Preview only — changes are not saved.'},{status:409});
    const path=url.pathname;
    if(path.endsWith('/sharing')&&url.searchParams.get('active')==='true')return Response.json([
      {id,target:'vrchat',title:'The Expanse',expiresAt:new Date(Date.now()+3600000).toISOString(),viewers:2,card:episode,canCopy:true},
      {id:show.id,target:'website',title:'Preview title',expiresAt:new Date(Date.now()+7200000).toISOString(),viewers:0,card:movie,canCopy:true},
    ]);
    if(/\/social\/works\/[^/]+\/friends$/.test(path))return Response.json({items:url.searchParams.get('filter')==='lists'?[]:[{id,kind:'person',title:'Alice',href:'/profile/Alice',poster:'/coast-mark.png',captionSubtitle:'4 / 5'}],page:1,pages:1,total:1});
    if(path.endsWith('/social/friends'))return Response.json(url.searchParams.get('state')==='pending'?[]:[{id,userId:id,username:'Alice',state:'accepted',requestedBy:id,avatar:null,canCompare:true,activityStatus:'online',backgroundArtwork:movie.backdrop}]);
    if(path.endsWith('/social/checkins'))return Response.json([{userId:id,title:'The Expanse — S01E03',href:'#',category:'screen',progress:.35,artwork:movie.backdrop}]);
    if(path.endsWith('/providers/streams'))return Response.json({view:url.searchParams.get('view')??'now',nextCursor:null,streams:[{id:'fixture-session',connectionId:id,externalId:'fixture-episode',username:'Alice',title:'The Expanse',episode:'S01E03',server:'Home',client:'Jellyfin Web',device:'Browser',paused:false,method:'DirectPlay',duration:2700,position:945,progress:.35,card:{...episode,available:true},actor:{username:'Alice',avatar:null,profileHref:'/profile/Alice'}},{id:'fixture-unmapped',connectionId:id,externalId:'fixture-unmapped',username:'Jellyfin guest',title:'Unimported movie',episode:null,server:'Home',client:'TV',device:'Living room',paused:true,method:'DirectStream',duration:6600,position:1800,progress:1800/6600,card:{id:'fixture-unmapped',kind:'movie',title:'Unimported movie',href:null},actor:{username:'Jellyfin guest',avatar:null,profileHref:null}}].map(stream=>({...stream,firstSeenAt:new Date(Date.now()-3600000).toISOString(),lastSeenAt:new Date(Date.now()-600000).toISOString(),endedAt:url.searchParams.get('view')==='history'?new Date().toISOString():null})),issues:[],checkedAt:new Date().toISOString()});
    if(path.endsWith('/members'))return Response.json({items:[{...notificationExamples[4],count:1}],hasMore:false});
    if(path.endsWith('/notifications')){
      const segment=url.searchParams.get('segment'),kind=url.searchParams.get('kind');
      return Response.json({items:notificationExamples.filter(n=>(!kind||kind==='all'||n.kind===kind)&&(!segment||segment==='all'||(segment==='social'?['recommendation','friend-request','reaction','synced-invite'].includes(n.kind):segment==='requests'?n.kind==='request':n.kind==='external-action'))),hasMore:false,next:null,unread:7,snapshot:new Date().toISOString()});
    }
    if(path.endsWith('/statistics'))return Response.json({days,today,watches:13,unique:7,undated:0,first:today,last:today});
    if(path.endsWith('/trailer'))return Response.json({url:null});
    if(path.endsWith('/actions'))return Response.json(actionData);
    if(path.endsWith('/metadata')||path.endsWith('/presentation'))return Response.json({override:{title:movie.title,overview:movie.overview},preference:null,locks:[],snapshots:[]});
    if(path.endsWith('/credits'))return Response.json({...content,departments:['Acting']});
    if(path.endsWith('/activity'))return Response.json({...content,items:journal});
    if(path.endsWith('/heroes'))return Response.json(items);
    if(path.endsWith('/options')&&path.includes('/requests/'))return Response.json({destinations:[]});
    if(path.endsWith('/sequence'))return Response.json({next:episode});
    if(path.endsWith('/library')&&url.searchParams.get('preview')==='true')return Response.json({items:[{...music,kind:'album',href:'#',poster:'/coast-mark.png'}],failure:''});
    if(/\/collection\/[^/]+\/lists$/.test(path))return Response.json({items:[{id,name:'Preview list',playlist:false,entries:[],count:0}],page:1,pages:1,total:1});
    if(/\/collection\/[^/]+$/.test(path))return Response.json({reasons:[],rating:null,queued:false,game:null,reading:null});
    if(path.endsWith('/collection'))return Response.json(content);
    if(path.endsWith('/library'))return Response.json(content);
    if(path.endsWith('/progress'))return Response.json({...content,view:'watching',category:'screen',kind:'all',scope:'all'});
    if(path.endsWith('/content'))return Response.json({...content,kind:'all',filter:'all'});
    if(path.endsWith('/history'))return Response.json({items:[],page:1,pages:1,total:0});
    return Response.json({error:'This action requires a live session outside the component preview.'},{status:409});
};

/** A finite transport per mounted specimen. Nothing falls through to network fetch. */
export function createPreviewTransport(name: string, scenario: string, conditions: MenuConditions = {}): import('#lib/ui/client.js').ApiTransport {
  let dismissed = new Set<string>();
  const revokedLinks = new Set<string>();
  const stoppedShares = new Set<string>();
  const featurePermissions = {permissions:{},preferences:{}};
  let sharingCreated = false;
  let benchmarkQueued = false;
  const activeCheckin = conditions.checkIn ? {id:show.id,workId:episode.id,mode:conditions.manualCheckIn ? 'manual' as const : 'timed' as const,expiresAt:today+'T22:00:00Z'} : null;
  const workState: WorkActionState = {reasons:[{relationship:'watchlist',origin:'direct'},{relationship:'collected',origin:'direct'}],rating:4,queued:false,activeCheckin,
    reading: ['book','comic'].includes(scenario) ? {state:conditions.dropped?'dropped':conditions.paused?'paused':conditions.completed?'completed':'reading',page:conditions.position===false?0:12,totalPages:220,rereadId:conditions.rewatch?id:null}:null,
    game: scenario==='game'?{platforms:['PC','PlayStation'],playthrough:conditions.playthrough===false?null:{id,status:conditions.dropped?'dropped':conditions.paused?'paused':conditions.completed?'completed':'in-progress',progressPercent:45,repeat:false,platform:'PC'}}:null};
  type Playthrough=NonNullable<GameActionState['playthrough']>&{createdAt:string};
  const playthroughs:Playthrough[]=workState.game?.playthrough?[
    {...workState.game.playthrough,createdAt:today+'T12:00:00Z'},
    {id:show.id,platform:'PlayStation',status:'paused',progressPercent:25,repeat:true,createdAt:today+'T11:00:00Z'},
    {id:episode.id,platform:'PC',status:'completed',progressPercent:100,repeat:true,createdAt:today+'T10:00:00Z'},
  ]:[];
  const listening=new Map<string,{id:string;title:string;occurredAt:string;dateKnown:boolean;source:string}[]>();
  const readingHistory=new Map<string,{id:string;state:string;page:number;totalPages:number|null;occurredAt:string}[]>();
  const playSessions=new Map<string,{id:string;minutesPlayed:number;playedAt:string;note:string|null}[]>();
  const historyIds=[id,episode.id,show.id];
  const logOptions=[{id:track.id,title:track.title},{id,title:'A second track'},{id:show.id,title:'A third track'}];
  const list=(target:string)=>{
    if(!listening.has(target))listening.set(target,historyIds.map((entry,index)=>({id:entry,title:logOptions[index].title,occurredAt:`${today}T${18-index}:00:00Z`,dateKnown:true,source:'manual'})));
    return listening.get(target)!;
  };
  const reads=(target:string)=>{
    if(!readingHistory.has(target))readingHistory.set(target,historyIds.map((entry,index)=>({id:entry,state:index?'reading':'completed',page:index?12:220,totalPages:220,occurredAt:`${today}T${18-index}:00:00Z`})));
    return readingHistory.get(target)!;
  };
  const sessions=(target:string)=>{
    if(!playSessions.has(target))playSessions.set(target,historyIds.map((entry,index)=>({id:entry,minutesPlayed:[30,90,125][index],playedAt:`${today}T${18-index}:00:00Z`,note:'Preview play session'})));
    return playSessions.get(target)!;
  };
  const slice=<T>(items:T[],url:URL)=>{
    const pages=Math.max(1,Math.ceil(items.length/2));
    const requested=Number.parseInt(url.searchParams.get('page')??'1',10);
    const page=Math.min(pages,Math.max(1,Number.isFinite(requested)?requested:1));
    return {items:items.slice((page-1)*2,page*2),page,pages,total:items.length,hasMore:page<pages};
  };
  return async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? String(input), 'http://preview.invalid');
    const path = url.pathname.replace(/^\/api\/v1\//, '');
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const signal = init?.signal ?? request?.signal;
    if (signal?.aborted) throw new DOMException('Preview request cancelled', 'AbortError');
    if (!url.pathname.startsWith('/api/v1/')) return Response.json({error: 'No live requests are permitted in this example.'}, {status: 409});
    if (scenario === 'error') return Response.json({error: 'The example service could not respond. You can retry safely.'}, {status: 503});
    if (scenario === 'loading' && method === 'GET' && signal) {
      // A held read, released by the existing component resource on close/replacement.
      await new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Preview request cancelled', 'AbortError')), {once: true}));
    }
    if (/^(?:media|playback)\/[^/]+\/subtitles$/.test(path)) {
      const tracks = previewSubtitleTracks;
      const source = { availabilityId: id, sourceId: id };
      const subtitleAction = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
      if (method === 'POST' && subtitleAction.language) return Response.json([
        { id: 'match', ticket: 'preview-match', name: 'Web release · 1080p', exact: true, format: 'srt', sdh: true, downloads: 2458 },
        { id: 'other', ticket: 'preview-other', name: 'Blu-ray release', exact: false, format: 'srt', downloads: 809 },
      ]);
      if (method === 'POST') return Response.json({
        tracks: [...tracks, { index: 5, label: 'English · SDH', language: 'eng', url: `${previewSubtitleUrl}%20%5BSDH%5D` }],
        index: 5, source,
      });
      return Response.json({ tracks, preferred: 'en', version: '1080p · Preview Jellyfin', scope: 'preview-subtitles', source });
    }
    if (name === 'WorkMenu') {
      if(method==='POST'&&path==='ratings'){
        const body=JSON.parse(typeof init?.body==='string'?init.body:'{}');
        workState.rating=body.value??null;
        return Response.json({ok:true});
      }
      if (method === 'GET' && /^collection\/[^/]+$/.test(path)){
        const selected=url.searchParams.get('playthrough');
        return Response.json(selected&&workState.game?{...workState,game:{...workState.game,playthrough:playthroughs.find(run=>run.id===selected)??null}}:workState);
      }
      const musicHistoryPath=path.match(/^music\/([^/]+)\/history(?:\/([^/]+))?$/);
      const readingHistoryPath=path.match(/^reading\/([^/]+)\/history(?:\/([^/]+))?$/);
      const gameSessionPath=path.match(/^game-playthroughs\/([^/]+)(?:\/sessions(?:\/([^/]+))?)?$/);
      if(method==='GET'&&musicHistoryPath&&!musicHistoryPath[2])return Response.json(slice(list(musicHistoryPath[1]),url));
      if(method==='GET'&&readingHistoryPath&&!readingHistoryPath[2])return Response.json(slice(reads(readingHistoryPath[1]),url));
      if(method==='GET'&&gameSessionPath&&!gameSessionPath[2]){
        const page=slice(sessions(gameSessionPath[1]),url);
        return Response.json({sessions:page.items,page:page.page,pages:page.pages,total:page.total});
      }
      if(method==='DELETE'&&(musicHistoryPath||readingHistoryPath||gameSessionPath?.[2])){
        const target=musicHistoryPath?.[1]??readingHistoryPath?.[1]??gameSessionPath![1];
        const entry=musicHistoryPath?.[2]??readingHistoryPath?.[2]??gameSessionPath![2];
        const items=musicHistoryPath?listening.get(target):readingHistoryPath?readingHistory.get(target):playSessions.get(target);
        const index=items?.findIndex(item=>item.id===entry)??-1;
        if(index<0)return Response.json({error:'This preview history entry does not belong to this target.'},{status:404});
        items!.splice(index,1);
        return Response.json({ok:true});
      }
      if(method==='GET'&&/^games\/[^/]+\/playthroughs$/.test(path))return Response.json(slice(playthroughs,url));
      if(method==='POST'&&/^games\/[^/]+\/playthroughs$/.test(path)){
        const body=JSON.parse(typeof init?.body==='string'?init.body:'{}');
        const run:Playthrough={id:crypto.randomUUID(),platform:body.platform??null,status:'in-progress',progressPercent:0,repeat:!!body.repeat,createdAt:today+'T19:00:00Z'};
        playthroughs.unshift(run);workState.game={platforms:workState.game?.platforms??['PC','PlayStation'],playthrough:run};
        return Response.json({id:run.id});
      }
      if(method==='POST'&&/^game-playthroughs\/[^/]+\/sessions$/.test(path)){
        const target=path.split('/')[1],body=JSON.parse(typeof init?.body==='string'?init.body:'{}');
        sessions(target).unshift({id:body.id??crypto.randomUUID(),minutesPlayed:body.minutesPlayed,playedAt:body.playedAt,note:body.note??null});
        return Response.json({ok:true});
      }

      if(method!=='GET' && (path==='tracking'||path==='up-next'||/^collection\/[^/]+$/.test(path))){
        const body=JSON.parse(typeof init?.body==='string'?init.body:'{}');
        const relationship=path==='tracking'?body.action:path==='up-next'?'queued':'collected';
        const enabled=path==='tracking'?body.value:path==='up-next'?body.queued:body.collected;
        if(relationship==='queued')workState.queued=!!enabled;
        else if(['watchlist','favourite','collected'].includes(relationship)){
          workState.reasons=workState.reasons.filter(reason=>reason.relationship!==relationship);
          if(enabled)workState.reasons.push({relationship,origin:'direct'});
        }
        return Response.json({ok:true});
      }
      if(method==='GET'&&/^music\/[^/]+\/log-options$/.test(path)){
        const page=slice(logOptions,url);return Response.json({items:page.items,hasMore:page.hasMore});
      }
      if(method==='POST'&&/^music\/[^/]+\/log$/.test(path)){
        const target=path.split('/')[1],body=JSON.parse(typeof init?.body==='string'?init.body:'{}');
        const entry={id:crypto.randomUUID(),title:logOptions.find(item=>item.id===target)?.title??`Preview ${scenario}`,occurredAt:body.occurredAt??today+'T19:00:00Z',dateKnown:true,source:'manual'};
        list(target).unshift(entry);
        const owner=menuPreviewItem(scenario,conditions);
        if(scenario==='artist'&&'workId' in owner&&owner.workId&&owner.workId!==target)list(owner.workId).unshift({...entry});
        return Response.json({id:entry.id});
      }

      if (method === 'GET' && /^social\/checkins\/tracks$/.test(path))return Response.json({items:[{id:track.id,title:track.title}],hasMore:false,activeCheckin:workState.activeCheckin});
      if (method === 'POST' && /^reading\/[^/]+\/progress$/.test(path)) {
        const body=JSON.parse(typeof init?.body==='string'?init.body:'{}');
        const previous=workState.reading;
        if(!previous)return Response.json({error:'This preview item has no reading state.'},{status:409});
        const updated:NonNullable<WorkActionState['reading']>={...previous,...body,...(body.restart?{rereadId:id}:{}),...(body.endReread?{rereadId:null,state:'completed'}:{}),...(body.reset?{page:0,hasBookmark:false}:{}),...(body.reset==='unread'?{state:'planned' as const,rereadId:null}:{})};
        workState.reading=updated;
        if(!body.reset&&!body.endReread)reads(path.split('/')[1]).unshift({id:crypto.randomUUID(),state:updated.state,page:updated.page,totalPages:updated.totalPages,occurredAt:body.occurredAt??today+'T19:00:00Z'});
        return Response.json(updated);
      }
      if (method === 'PATCH' && /^game-playthroughs\/[^/]+$/.test(path)) {
        const body=JSON.parse(typeof init?.body==='string'?init.body:'{}');
        const target=path.split('/')[1],run=playthroughs.find(run=>run.id===target);
        if(!run)return Response.json({error:'This preview playthrough no longer exists.'},{status:404});
        Object.assign(run,body);
        if(workState.game?.playthrough?.id===target)Object.assign(workState.game.playthrough,body);
        return Response.json({id:target});
      }
      if(method!=='GET' && /^(games|music)\//.test(path))return Response.json({id});
      const item = menuPreviewItem(scenario, conditions);
      if(method==='POST'&&/^media\/[^/]+\/refresh$/.test(path)&&!('href' in item)){
        const target=previewMediaTargets(item,conditions).refreshTarget;
        return target&&path===`media/${target.id}/refresh`?Response.json({queued:true}):Response.json({error:'No metadata source is available for this preview target.'},{status:409});
      }
      if (method === 'GET' && /^media\/[^/]+\/actions$/.test(path) && !('href' in item)) {
        const direct=new Set(workState.reasons.filter(reason=>reason.origin==='direct').map(reason=>reason.relationship));
        const personal={watchlist:direct.has('watchlist'),favourite:direct.has('favourite'),collected:direct.has('collected'),queued:workState.queued,rating:workState.rating};
        const current={...item,...personal};
        const grouped = ['show', 'season', 'collection'].includes(item.kind);
        return Response.json({
          ...actionData, ...previewMediaTargets(item,conditions), item:current, wholeWork: item.kind === 'episode' || item.kind === 'season' ? {
            ...show, rewatchStartedAt: item.rewatchStartedAt, status: item.status,
          } : current,
          activeCheckin: workState.activeCheckin,
          activeCheckinId: conditions.checkIn ? show.id : null,
          requestsEnabled: conditions.requests ?? false,
          hasReleaseDate: conditions.airDate ?? true,
          requests: conditions.existingRequest ? [{id:episode.id,state:'pending',seasons:[1],destination:'Preview Jellyfin',is4k:false,canApprove:true,canCancel:true,canDecline:true}] : [],
          playable: item.available ? (grouped ? { ...episode, available: true } : item) : null,
          editions: item.available && conditions.versions !== false ? ['', 'Extended'] : [],
        });
      }
      if (method === 'GET' && path === 'social/checkins/episodes') return Response.json({
        items: [{id: episode.id, title: episode.title, seasonNumber: 1, episodeNumber: 1}], hasMore: false,
      });
      if (method === 'GET' && path === 'requests/options') return Response.json({
        destinations: [{ id, name: 'Preview Jellyfin', variants: {
          standard: {serverId:1,requestable:true,available:false,requested:false,seasons:[1,2,3].map(number=>({number,available:number===1,requested:number===2,mine:number===2}))},
          fourK: conditions.fourK ? {serverId:2,requestable:true,available:false,requested:false,seasons:[1,2,3].map(number=>({number,available:false,requested:false,mine:false}))} : null
        }}]
      });
      if (method !== 'GET' && ['ratings','tracking','rewatch','profile','social/checkins'].some(prefix=>path===prefix||path.startsWith(prefix+'/'))) {
        return Response.json({id:show.id,workId:item.id,mode:'timed',expiresAt:today+'T22:00:00Z',state:'cancelled'});
      }
      if (scenario === 'list-entry' && (path === `lists/${show.id}/move` || path === `lists/${show.id}/items`)) {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
        return body.entryId === episode.id ? Response.json({ ok: true }) : Response.json({ error: 'Unexpected entry.' }, {status:422});
      }
    }
    if (path === 'admin/users/'+id+'/features') {
      if (method==='PATCH') {
        const updates=JSON.parse(String(init?.body ?? '{}'));
        Object.assign(featurePermissions.permissions,updates.permissions);
        Object.assign(featurePermissions.preferences,updates.preferences);
      }
      return Response.json(featurePermissions);
    }
    if (method==='POST' && path==='member-invites') return Response.json({code:'COAST-PREVIEW'});
    if (method !== 'GET') {
      if (name === 'ProfileEditor' && path === 'profile' && method === 'POST') return Response.json({ ok: true });
      if (name === 'StreamsPanel' && path.startsWith('sharing/')) {
        const [, linkId, action] = path.split('/');
        if (method === 'DELETE' && !action) {
          revokedLinks.add(linkId);
          return Response.json({revoked:true});
        }
        if (method === 'POST' && action === 'stop') {
          stoppedShares.add(linkId);
          return Response.json({stopped:linkId==='preview-share'?2:1});
        }
      }
      if ((name === 'sharing.action'||name==='WorkMenu') && path === 'sharing' && method === 'POST') {
        const body=JSON.parse(typeof init?.body==='string'?init.body:'{}');
        sharingCreated = true; return Response.json({id, token: 'preview-only-not-a-real-link', target:body.target??'website'});
      }
      if (path === `sharing/${id}` && method === 'DELETE' && sharingCreated) { sharingCreated = false; return Response.json({ok: true}); }
      if (path === 'planning' && method === 'POST') return Response.json({id});
      if (name === 'admin.benchmark' && path === 'admin/benchmarks' && method === 'POST') { benchmarkQueued = true; return Response.json({queued:1, activeId:id}); }
      if (path.startsWith('notifications/') && method === 'POST') {
        dismissed.add(path.split('/')[1]);
        return Response.json({ids: [], ok: true});
      }
      // Unknown writes deliberately fail closed; there is never a production fallback.
      return fixtureFetch(input, init);
    }
    if (/^providers\/[^/]+\/scan$/.test(path)) return Response.json(scenario === 'disconnected' ? null : {state: 'completed', processed: 40, total: 40, phase: 'Ready', error: null, attempts: 0});
    if (path === 'sharing/sources') return Response.json(scenario === 'empty' ? [] : [{id, name: 'Preview Jellyfin'}]);
    if (name === 'ProfileEditor' && path === 'profile/avatars') return Response.json([]);
    if (/^reading\/[^/]+\/connections$/.test(path)) return Response.json(scenario === 'local' ? [] : [{id, name: 'Preview reading library'}]);
    if (/^reading\/[^/]+\/sources$/.test(path)) return Response.json({items: scenario === 'empty' ? [] : [{id, title: 'Preview edition', format: 'epub'}, {id: episode.id, title: 'A PDF edition', format: 'pdf'}, {id: show.id, title: 'Unsupported archive', format: null}], nextOffset: null});
    if (path.startsWith('profile/avatars/')) {
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), letter => letter.charCodeAt(0));
      return new Response(bytes, {headers: {'content-type': 'image/png'}});
    }
    if (name === 'admin.benchmark' && path === 'admin/benchmarks') return Response.json({runs:benchmarkQueued?[{id,actionId:null,userId:null,state:'queued',workloadVersion:'coast-local-v2',createdAt:today,startedAt:null,finishedAt:null,context:null,measurements:null,comparisonKey:null,errors:[]}]:[],total:benchmarkQueued?1:0,page:1,pages:1,activeId:benchmarkQueued?id:null});
    if (/^music\/[^/]+\/children$/.test(path)) return Response.json({items:[{...track,workId:track.id,kind:'track',href:'#',poster:'/coast-mark.png',available:true}],page:1,pages:1,total:1});
    if (/^reading\/[^/]+\/credits$/.test(path))return Response.json([{name:'Alex Example',role:'Writer'},{name:'Sam Example',role:'Artist'}]);
    if (/^reading\/[^/]+\/community$/.test(path))return Response.json({reading:8,completed:12,rated:4,rating:4.25});
    if (/^reading\/[^/]+\/related$/.test(path))return Response.json({items:[],page:1,pages:1,total:0});
    if (/^reading\/[^/]+\/issues$/.test(path)) return Response.json({title:'Preview comic volume',href:'#',items:[{id:'4000-123',kind:'comic',title:'Preview comic #1',href:'#',poster:'/coast-mark.png'},{id:'4000-124',kind:'comic',title:'Preview comic #2',href:'#',poster:'/coast-mark.png'}],page:1,pages:1,total:2});
    if (/^reading\/collections\/[^/]+$/.test(path)) return Response.json({items:[{id:'4000-123',kind:'comic',title:'Preview comic #1',href:'#',poster:'/coast-mark.png'}],page:1,pages:1,total:1});
    if (/^reading\/[^/]+\/editions$/.test(path)) return Response.json({items:[{id:'edition:OL456M',kind:'book',title:'Preview edition',href:'#',poster:'/coast-mark.png',captionSubtitle:'2026 · Preview publisher'}],page:1,pages:1,total:1});
    if (/^reading\/[^/]+\/linked$/.test(path)) return Response.json([]);
    if (/^game-playthroughs\/[^/]+$/.test(path)) return Response.json({sessions:[30,90,125].map((minutes,index)=>({id:`preview-session-${index}`,playedAt:`2026-10-0${index+1}T18:00:00Z`,minutesPlayed:minutes,note:'Preview play session'})),page:1,pages:1,total:3});
    if (path === 'member-invites') return Response.json({items:[],next:null,grant:{remaining:2,quota:3},request:null});
    if (path === 'admin/invites/presets') return Response.json([]);
    if (path === 'admin/invites/overview') return Response.json({funnel:[],audit:[],requests:[]});
    if (path === 'admin/invites') return Response.json({items:[],next:null});
    if (path === 'admin/members/'+id) return Response.json({id,username:'Alex',role:'user',source:'Invitation',connections:[],audit:[],access:{},expiresAt:null});
    if (path === 'admin/demand') return Response.json({page:1,pages:1,users:scenario==='empty'?[]:[{username:'Alex',page:1,pages:1,items:[{href:'#',neededTitle:movie.title,reason:'Watchlist',availability:'missing',sources:[],requests:[]}]}]});
    if (path === 'synced/preview-party/media') return Response.json(episode);
    if (path === 'profile/taste-match' || path === 'admin/taste-score') {
      const score=scenario==='for-you'?86:72;
      const match=url.searchParams.has('group')
        ? {score,members:{total:2,sampled:2,matched:2},breakdown:{average:score-2,bonus:2,watched:1,titles:items.map(item=>({id:item.id,title:item.title,confidence:70,score:score-2}))}}
        : {score,native:score,rule:'personal',confidence:70,withheld:false,base:65,reason:'Similar genres',signals:[{dimension:'genres',name:'Drama',contribution:score-65,works:8,rated:5,affinity:80}]};
      return Response.json({match});
    }
    if (name==='pages.browse' && scenario==='empty' && ['library/recent','requests','social/feed','progress','planning','progress/experiment'].includes(path))
      return Response.json({items:[],page:1,pages:1,total:0,next:null,view:url.searchParams.get('view')??'watching',kind:'all',scope:'all'});
    if (path === 'profile/taste-signals') return Response.json({
      works:12,ratings:6,pages:1,dimensions:[{key:'genres',count:1}],uses:{},examples:{},
      items:[{id:'drama',name:'Drama',affinity:84,works:8,rated:5,confidence:72,supporting:[],contradicting:[]}],
    });
    if (['library/recent','requests','lists/content','social/feed','progress/recommendations','experiments/upcoming'].includes(path) && method==='GET')
      return Response.json({...content,next:null,hasMore:false});
    if (path === 'progress/experiment') return Response.json({...content,items:[episode,movie],view:url.searchParams.get('view')??'continue',kind:'all',scope:'all'});
    if (path === 'synced') return Response.json(scenario==='parties'?[{id,createdAt:today+'T18:00:00Z',host:'Alice',hostId:id,joined:true,mediaType:'video',progress:.3,durationSeconds:2700,positionSeconds:810,paused:true,bufferingPaused:false,updatedAt:today+'T18:00:00Z',playingItem:episode,nowPlaying:episode.title,backgroundArtwork:movie.backdrop,friend:null,participants:[{userId:id,username:'Alice',avatar:null,joined:true}]}]:[]);
    if (path === 'experiments/feed' || path === 'discover/feed') return Response.json({rows: scenario === 'empty' ? [] : [{key:'preview-row', title:'More stories to discover', category:'screen', surface:'genre', genre:'Drama', kind:'movie', reason:'liked'}]});
    if (path === 'discover/row' || path === 'experiments/row' || path === 'experiments/recommendations') return Response.json({...content, title:'More stories to discover'});
    const response = await fixtureFetch(input, init);
    if (!response.ok) return response;
    const result = await response.json();
    if (path === 'sharing' && url.searchParams.get('active') === 'true')
      return Response.json(scenario === 'empty' ? [] : result.filter((link:{id:string}) => !revokedLinks.has(link.id))
        .map((link: {canCopy: boolean}) => conditions.copyable === false || scenario === 'older-link' ? { ...link, canCopy: false } : link));
    if (path === 'notifications') {
      result.items = result.items.filter((notice: NotificationEntry) => notice.kind !== 'friend-request' && !dismissed.has(notice.id))
        .map((notice: NotificationEntry) => ({...notice, readAt: scenario === 'read' ? today : null, locked: scenario === 'locked', ...(notice.kind === 'reaction' ? {reaction:'❤️', media:null, activity:{...movie, captionActor:{username:'Preview',avatar:null}, captionSubtitle:'Watched this movie'}} : {})}));
      if (scenario === 'attachments') result.items.push({id:show.id, kind:'friend-accepted', title:'Accepted your friend request', body:null, createdAt:today, readAt:null, locked:false, actor:{username:'Sam',avatar:null,status:'online'}, friend:{id:show.id,userId:show.id,username:'Sam',state:'accepted',requestedBy:id,avatar:null,canCompare:true,activityStatus:'online'}, media:null, sourceLabel:null,destination:null,requestState:null,sessionState:null,actions:[],subjectId:show.id});
      if (scenario === 'empty') result.items = [];
      result.unread = scenario === 'read' || conditions.unread===false ? 0 : result.items.length;
    }
    if (scenario === 'requests' && path === 'social/friends') return Response.json([{id, userId: id, username: 'Alice', state: 'pending', requestedBy: episode.id, avatar: null, canCompare: false, activityStatus: 'offline'}]);
    if (path === 'providers/streams') {
      if (scenario === 'issues') result.issues = [{server:'Preview library',message:'The server could not respond; settled sessions remain visible.'}];
      if (scenario === 'shared' && result.streams.length) {
        const [stream,...others]=result.streams;
        const sharing={linkId:'preview-share',creator:'Preview',viewers:2,estimated:true,bitrateMbps:6};
        result.streams=[
          {...stream,client:'External player',device:null,method:'Shared HLS',sharing},
          {...stream,id:'fixture-viewer-2',client:'External player',device:null,method:'Shared HLS',position:360,progress:360/stream.duration,sharing},
          {...stream,id:'fixture-viewer-3',client:'External player',device:null,method:'Shared HLS',sharing:{...sharing,linkId:'preview-other-share',viewers:1}},
          ...others,
        ].filter(stream => result.view==='history' || !stoppedShares.has(stream.sharing?.linkId));
      }
    }
    if (scenario === 'empty') {
      if (Array.isArray(result)) return Response.json([]);
      if (result.items) { result.items = []; result.total = 0; result.pages = 1; }
      if (result.streams) result.streams = [];
    }
    return Response.json(result);
  };
}
