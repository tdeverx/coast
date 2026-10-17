import type {NotificationEntry} from '$lib/notifications/model';
import type { MediaView } from '$lib/ui/types';
import type { JournalEntry } from '$lib/profile/journal';
import type { MusicItem } from '$lib/music/model';
import type { MediaActionData } from '$lib/media/actions';
import { providerSchedule } from '$lib/providers/schedule';
export const id='00000000-0000-4000-8000-000000000074';
export const today='2026-10-01';
export const movie:MediaView={id,kind:'movie',title:'Preview title',overview:'Demo content for comparing the existing components. Nothing in this preview is saved.',year:2026,genres:['Drama','Adventure'],runtimeMinutes:110,available:false,progress:1800,duration:6600,watched:false,playCount:0,watchlist:true,favourite:false,collected:true,dropped:false,rating:4,poster:'/coast-mark.png',backdrop:'/coast-mark.png'};
export const show:MediaView={...movie,id:'00000000-0000-4000-8000-000000000075',kind:'show',title:'Preview series',progress:0,totalEpisodes:8,completedEpisodes:3};
export const episode:MediaView={...movie,id:'00000000-0000-4000-8000-000000000076',kind:'episode',title:'A first chapter',showId:show.id,seasonNumber:1,episodeNumber:1};
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
export const actionData:MediaActionData={item:movie,wholeWork:movie,releaseDate:'2026-01-01',hasReleaseDate:true,progressTargetIds:[id],hasPersonalOverrides:false,ownRewatchStartedAt:null,rewatchTargetIds:[id],targets:[movie],requestTarget:movie,requestsEnabled:false,refreshTarget:null,playable:null,editions:[],requests:[]};

const notificationExamples:NotificationEntry[]=[
 {id:'00000000-0000-4000-8000-000000000001',kind:'recommendation',title:'Recommended something to you',body:null,actor:{username:'Alice',avatar:null,status:'online'},media:{card:movie,id,title:movie.title,href:`/media/${id}`,artwork:movie.backdrop??movie.poster??null,availability:'available',stale:false},createdAt:today,readAt:null,locked:false,sourceLabel:null,destination:null,requestState:null,sessionState:null,actions:['save','dismiss'],subjectId:id},
 {id:'00000000-0000-4000-8000-000000000006',kind:'synced-invite',title:'Join a synced session',body:null,actor:{username:'Alice',avatar:null,status:'online'},media:{card:movie,id,title:movie.title,href:`/media/${id}`,artwork:movie.backdrop??movie.poster??null,availability:'available',stale:false},createdAt:today,readAt:null,locked:false,sourceLabel:null,destination:`/synced/${id}`,requestState:null,sessionState:'Playing',actions:['decline'],subjectId:id},
 {id:'00000000-0000-4000-8000-000000000002',kind:'friend-request',title:'Wants to be friends',body:null,actor:{username:'Sam',avatar:null,status:'away'},media:null,createdAt:today,readAt:null,locked:false,sourceLabel:null,destination:'/for-you?friends=true',requestState:null,sessionState:null,actions:['accept','decline'],subjectId:id},
 {id:'00000000-0000-4000-8000-000000000003',kind:'request',title:'Your requested title is available',body:'Ready to watch from your connected library.',actor:null,media:{card:movie,id,title:movie.title,href:`/media/${id}`,artwork:movie.backdrop??movie.poster??null,availability:'available',stale:false},createdAt:today,readAt:null,locked:false,sourceLabel:null,destination:'/requests',requestState:'available',sessionState:null,actions:[],subjectId:id},
 {id:'00000000-0000-4000-8000-000000000004',kind:'external-action',title:'A connected service needs attention',body:'Reconnect this account to resume synchronization.',actor:null,media:null,createdAt:today,readAt:null,locked:false,sourceLabel:'Jellyfin · User synchronization',destination:'/settings/jobs',requestState:null,sessionState:null,actions:[],subjectId:null},
 {id:'00000000-0000-4000-8000-000000000005',kind:'reaction',title:'Reacted ❤️ to your activity',body:null,actor:{username:'Taylor',avatar:null,status:'busy'},media:{card:movie,id,title:movie.title,href:`/media/${id}`,artwork:movie.backdrop??movie.poster??null,availability:'available',stale:false},createdAt:today,readAt:null,locked:false,sourceLabel:null,destination:'/for-you?section=activity',requestState:null,sessionState:null,actions:[],subjectId:id}
];
/** Synthetic transport is injected only into preview descendants. */
export const fixtureFetch: import('$lib/ui/client').ApiTransport = async (input, init) => {
    const url=new URL(input instanceof Request?input.url:String(input),'http://preview.invalid');
    if(!url.pathname.startsWith('/api/'))return new Response('Preview only', {status:409});
    const method=(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    if(url.pathname.endsWith('/providers/streams/refresh')&&method==='POST')return Response.json({queued:1});
    if(method!=='GET')return Response.json({error:'Preview only — changes are not saved.'},{status:409});
    const path=url.pathname;
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
export function createPreviewTransport(name: string, scenario: string): import('$lib/ui/client').ApiTransport {
  let dismissed = new Set<string>();
  let sharingCreated = false;
  let benchmarkQueued = false;
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
    if (method !== 'GET') {
      if (name === 'sharing.action' && path === 'sharing' && method === 'POST') { sharingCreated = true; return Response.json({id, token: 'preview-only-not-a-real-link'}); }
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
    if (path === 'synced') return Response.json([]);
    if (path === 'experiments/feed') return Response.json({rows: scenario === 'empty' ? [] : [{key:'preview-row', title:'More stories to discover', category:'screen', surface:'genre', genre:'Drama', kind:'movie', reason:'liked'}]});
    if (path === 'experiments/row' || path === 'experiments/recommendations') return Response.json({...content, title:'More stories to discover'});
    const response = await fixtureFetch(input, init);
    if (!response.ok) return response;
    const result = await response.json();
    if (path === 'notifications') {
      result.items = result.items.filter((notice: NotificationEntry) => notice.kind !== 'friend-request' && !dismissed.has(notice.id))
        .map((notice: NotificationEntry) => ({...notice, readAt: scenario === 'read' ? today : null, locked: scenario === 'locked', ...(notice.kind === 'reaction' ? {reaction:'❤️', media:null, activity:{...movie, captionActor:{username:'Preview',avatar:null}, captionSubtitle:'Watched this movie'}} : {})}));
      if (scenario === 'attachments') result.items.push({id:show.id, kind:'friend-accepted', title:'Accepted your friend request', body:null, createdAt:today, readAt:null, locked:false, actor:{username:'Sam',avatar:null,status:'online'}, friend:{id:show.id,userId:show.id,username:'Sam',state:'accepted',requestedBy:id,avatar:null,canCompare:true,activityStatus:'online'}, media:null, sourceLabel:null,destination:null,requestState:null,sessionState:null,actions:[],subjectId:show.id});
      if (scenario === 'empty') result.items = [];
      result.unread = scenario === 'read' ? 0 : result.items.length;
    }
    if (scenario === 'requests' && path === 'social/friends') return Response.json([{id, userId: id, username: 'Alice', state: 'pending', requestedBy: episode.id, avatar: null, canCompare: false, activityStatus: 'offline'}]);
    if (path === 'providers/streams') {
      if (scenario === 'issues') result.issues = [{server:'Preview library',message:'The server could not respond; settled sessions remain visible.'}];
      if (scenario === 'shared' && result.streams.length) result.streams[0].sharing = {creator:'Preview',viewers:4,estimated:true,bitrateMbps:6};
    }
    if (scenario === 'empty') {
      if (Array.isArray(result)) return Response.json([]);
      if (result.items) { result.items = []; result.total = 0; result.pages = 1; }
      if (result.streams) result.streams = [];
    }
    return Response.json(result);
  };
}
