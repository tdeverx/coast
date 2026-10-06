import {requireAdmin,type SessionUser} from '$lib/server/auth';
import {getSql} from '$lib/server/db';
import {providerSchedule} from '$lib/providers/schedule';
import {runProviderJob} from '$lib/providers/maintenance.server';
import * as v from 'valibot';
import type {streamPresentation} from '$lib/providers/jellyfin/streams';
import {workCards} from '$lib/collection/query.server';
import {profilePath} from '$lib/profile/url';
import type {MediaView,MediaCardPresentation,MediaCardDisplay} from '$lib/ui/types';
type Stream=NonNullable<ReturnType<typeof streamPresentation>>;
export type StreamsSnapshot={streams:(Stream&{firstSeenAt:string;lastSeenAt:string;endedAt:string|null;server:string;connectionId:string|null;card:MediaView|MediaCardPresentation|MediaCardDisplay;actor:{username:string;avatar:string|null;profileHref:string|null}})[];issues:{server:string;message:string}[];checkedAt:string|null;nextCursor:string|null;view:'now'|'history'};
/** Resolve a whole server's streams in bounded batches; never fetch artwork directly from private server URLs. */
export async function streamCards<T extends Stream>(userId:string,instanceId:string,streams:T[]){
 if(!streams.length)return [];
 const sql=getSql(),ids=[...new Set(streams.map(stream=>stream.externalId))],users=[...new Set(streams.flatMap(stream=>stream.externalUserId?[stream.externalUserId]:[]))];
 const [mappings,actors]=await Promise.all([
  sql<{externalId:string;workId:string}[]>`select external_id as "externalId",media_id as "workId" from provider_items where instance_id=${instanceId} and external_id in ${sql(ids)}`,
  users.length?sql<{externalUserId:string;username:string;avatar:string|null}[]>`select i.external_user_id as "externalUserId",u.username,case when social_visible(u.id,${userId}::uuid,'details') then u.settings->'profile'->>'avatar' end as avatar from user_identities i join users u on u.id=i.user_id where i.instance_id=${instanceId} and i.external_user_id in ${sql(users)} and not u.disabled`:[],
 ]);
 const workIds=[...new Set(mappings.map(row=>row.workId))],cards=new Map<string,MediaView|MediaCardPresentation>();
 for(let start=0;start<workIds.length;start+=50)for(const card of await workCards(userId,userId,workIds.slice(start,start+50)))cards.set('workId' in card?card.workId??card.id:card.id,card);
 const mediaTypes={Episode:'episode',Series:'show',Season:'season',Audio:'track',MusicAlbum:'album',MusicArtist:'artist'} as const;
 return streams.map(stream=>{
  const mapping=mappings.find(row=>row.externalId===stream.externalId),actor=actors.find(row=>row.externalUserId===stream.externalUserId);
  const fallback:MediaCardDisplay={id:stream.externalId,kind:mediaTypes[stream.mediaType as keyof typeof mediaTypes]??'movie',title:stream.title,href:null};
  return {...stream,card:(mapping?cards.get(mapping.workId):undefined)??fallback,actor:{username:actor?.username??stream.username,avatar:actor?.avatar??null,profileHref:actor?profilePath(actor.username):null}};
 });
}
type Source={id:string;name:string;settings:{schedule?:unknown};connection_id:string|null;checked_at:Date|null;last_error:string|null;valid:boolean;eligible:boolean;job_state:string|null};
async function streamSources(){return getSql()<Source[]>`select i.id,i.name,i.settings,s.connection_id,s.checked_at,s.last_error,
 coalesce(c.status='connected' and c.account_generation=s.account_generation and u.role='admin' and not u.disabled,false) as valid,
 exists(select 1 from provider_connections source join users owner on owner.id=source.user_id where source.instance_id=i.id and source.status='connected' and owner.role='admin' and not owner.disabled and (i.settings->'schedule'->>'streamsConnectionId' is null or source.id::text=i.settings->'schedule'->>'streamsConnectionId')) as eligible,
 job.state as job_state
 from provider_instances i left join server_stream_scans s on s.instance_id=i.id left join provider_connections c on c.id=s.connection_id left join users u on u.id=c.user_id
 left join lateral(select a.state from outbox_actions a join provider_connections source on source.id=a.connection_id where source.instance_id=i.id and a.kind='jellyfin.streams' and a.account_generation=source.account_generation and source.status='connected' order by a.updated_at desc,a.id desc limit 1) job on true
 where i.enabled and i.provider='jellyfin' order by i.name,i.id`;}
function fresh(source:Source){return source.valid&&!source.last_error&&!!source.checked_at&&Date.now()-new Date(source.checked_at).getTime()<=Math.max(3,providerSchedule('jellyfin',source.settings.schedule).streamsIntervalMinutes*2)*60000;}
export async function streamCount(actor:SessionUser|null){
 requireAdmin(actor);const sources=await streamSources();
 if(sources.some(source=>!fresh(source)))return {active:null};
 const ids=sources.map(source=>source.id);if(!ids.length)return {active:0};
 const [row]=await getSql()`select count(*)::int as count from server_stream_sessions where instance_id in ${getSql()(ids)} and ended_at is null`;
 return {active:row.count as number};
}
const querySchema=v.object({view:v.optional(v.picklist(['now','history']),'now'),before:v.optional(v.pipe(v.string(),v.check(value=>{const [date,id,...rest]=value.split('|');return !rest.length&&v.safeParse(v.pipe(v.string(),v.isoTimestamp()),date).success&&v.safeParse(v.pipe(v.string(),v.uuid()),id).success;})))});
export async function activeStreams(actor:SessionUser|null,input:unknown={}):Promise<StreamsSnapshot>{
 const user=requireAdmin(actor),query=v.parse(querySchema,input),sources=await streamSources(),sql=getSql();
 const snapshot:StreamsSnapshot={streams:[],issues:[],checkedAt:null,nextCursor:null,view:query.view};
 for(const source of sources)if(!fresh(source))snapshot.issues.push({server:source.name,message:source.last_error??(!source.eligible?'Choose a connected Jellyfin administrator in the Server streams job schedule.':source.job_state==='failed'?'The server scan failed. Retry Server streams in Jobs.':!source.checked_at?(source.job_state==='running'?'Scanning server streams.':source.job_state==='pending'?'Server scan queued.':'No server scan has completed. Run Server streams in Jobs.'):'Waiting for the next server scan. Previous observations may be stale.')});
 const ids=sources.filter(source=>query.view==='history'||source.valid).map(source=>source.id);
 if(!sources.length)snapshot.issues.push({server:'Jellyfin',message:'Connect a Jellyfin administrator account to record server streams.'});
 if(!ids.length)return snapshot;
 const [beforeTime,beforeId]=query.before?.split('|')??[];
 const order=query.view==='history'?sql`last_seen_at`:sql`first_seen_at`;
 const rows=await sql<{id:string;instance_id:string;snapshot:Stream;first_seen_at:Date;last_seen_at:Date;ended_at:Date|null}[]>`select id,instance_id,snapshot,first_seen_at,last_seen_at,ended_at from server_stream_sessions where instance_id in ${sql(ids)} and ${query.view==='history'?sql`ended_at is not null`:sql`ended_at is null`} ${beforeTime?sql`and (${order},id)<(${beforeTime}::timestamptz,${beforeId}::uuid)`:sql``} order by ${order} desc,id desc limit 21`;
 const page=rows.slice(0,20);
 if(rows.length>20){const last=page.at(-1)!;snapshot.nextCursor=new Date(query.view==='history'?last.last_seen_at:last.first_seen_at).toISOString()+'|'+last.id;}
 for(const source of sources){const sessions=page.filter(row=>row.instance_id===source.id).map(row=>({...row.snapshot,id:row.id,firstSeenAt:new Date(row.first_seen_at).toISOString(),lastSeenAt:new Date(row.last_seen_at).toISOString(),endedAt:row.ended_at?new Date(row.ended_at).toISOString():null}));snapshot.streams.push(...(await streamCards(user.id,source.id,sessions)).map(stream=>({...stream,server:source.name,connectionId:source.connection_id})));}
 snapshot.streams.sort((a,b)=>(query.view==='history'?b.lastSeenAt.localeCompare(a.lastSeenAt):b.firstSeenAt.localeCompare(a.firstSeenAt))||b.id.localeCompare(a.id));
 snapshot.checkedAt=sources.reduce<string|null>((latest,source)=>{const date=source.checked_at?new Date(source.checked_at).toISOString():null;return date&&(!latest||date>latest)?date:latest;},null);
 return snapshot;
}
export async function refreshStreams(actor:SessionUser|null){
 const user=requireAdmin(actor),sources=await streamSources();let queued=0,needsAttention=0,unavailable=0;
 for(const source of sources){
  if(!source.eligible){unavailable++;continue;}
  if(source.job_state==='failed'){needsAttention++;continue;}
  queued+=(await runProviderJob(user.id,source.id,'streams','jellyfin.streams')).queued;
 }
 return {queued,needsAttention,unavailable};
}
