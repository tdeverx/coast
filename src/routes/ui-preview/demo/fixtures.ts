import type {NotificationEntry} from '$lib/notifications/model';
import type { MediaView } from '$lib/ui/types';
import type { JournalEntry } from '$lib/profile/journal';
import type { MusicItem } from '$lib/music/model';
import type { MediaActionData } from '$lib/media/actions';
import { providerSchedule } from '$lib/providers/schedule';
export const id='00000000-0000-4000-8000-000000000074';
export const today='2026-10-01';
export const movie:MediaView={id,kind:'movie',title:'Preview title',overview:'Demo content for comparing the existing components. Nothing in this preview is saved.',year:2026,genres:['Drama','Adventure'],runtimeMinutes:110,available:false,progress:1800,duration:6600,watched:false,playCount:0,watchlist:true,favourite:false,collected:true,dropped:false,rating:8,poster:'/coast-mark.png',backdrop:'/coast-mark.png'};
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
export const actionData:MediaActionData={item:movie,wholeWork:movie,releaseDate:'2026-01-01',hasReleaseDate:true,progressTargetIds:[id],hasPersonalOverrides:false,ownRewatchStartedAt:null,rewatchTargetIds:[id],targets:[movie],children:[],requestTarget:movie,requestsEnabled:false,refreshTarget:null,playable:null,editions:[],lists:[],requests:[]};

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
    const url=new URL(input instanceof Request?input.url:String(input),location.href);
    if(!url.pathname.startsWith('/api/'))return new Response('Preview only', {status:409});
    const method=(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    if(method!=='GET')return Response.json({error:'Preview only — changes are not saved.'},{status:409});
    const path=url.pathname;
    if(path.endsWith('/social/friends'))return Response.json(url.searchParams.get('state')==='pending'?[]:[{id,userId:id,username:'Alice',state:'accepted',requestedBy:id,avatar:null,canCompare:true,activityStatus:'online',backgroundArtwork:movie.backdrop}]);
    if(path.endsWith('/social/checkins'))return Response.json([]);
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
    if(path.endsWith('/collection'))return Response.json(content);
    if(path.endsWith('/library'))return Response.json(content);
    if(path.endsWith('/progress'))return Response.json({...content,view:'watching',kind:'all',scope:'all'});
    if(path.endsWith('/content'))return Response.json({...content,kind:'all',filter:'all'});
    if(path.endsWith('/history'))return Response.json({items:[],page:1,pages:1,total:0});
    return Response.json({error:'This action requires a live session outside the component preview.'},{status:409});
};
