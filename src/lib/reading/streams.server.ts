import { getSql } from '#lib/server/db/index.js';
import { workCards } from '#lib/collection/query.server.js';
import { profilePath } from '#lib/profile/url.js';
import type { ReadingLocation } from './model';
import type { StreamsSnapshot } from '#lib/application/streams.server.js';

// Admin operational activity uses the existing reader sessions, not a provider
// playback scan: downloading a comic never creates a Jellyfin playback session.
function eligible(userId: string) {
  const sql = getSql();
  return sql`not u.disabled and coast_feature_enabled(u.id,'reader')
    and coast_feature_enabled(${userId}::uuid,'reader')
    and coast_category_enabled(u.id,w.kind)
    and coast_category_enabled(${userId}::uuid,w.kind)`;
}
function active() {
  const sql = getSql();
  return sql`s.closed_at is null and s.expires_at>now() and s.updated_at>now()-interval '2 minutes'
    and (s.connection_id is null or c.status='connected' and i.enabled and c.account_generation=s.account_generation)`;
}
export async function readingStreamCount(userId: string) {
  const sql = getSql();
  const [row] = await sql`select count(*)::int as count from reading_sessions s
    join users u on u.id=s.user_id join reading_works w on w.id=s.work_id
    left join provider_connections c on c.id=s.connection_id
    left join provider_instances i on i.id=c.instance_id
    where ${eligible(userId)} and ${active()}`;
  return row.count as number;
}
export async function readingStreamRows(userId: string, view: 'now' | 'history', before?: string): Promise<StreamsSnapshot['streams']> {
  const sql = getSql(), [beforeTime, beforeId] = before?.split('|') ?? [];
  // The shared cursor carries ISO milliseconds; compare at that same precision
  // so distinct rows within one database millisecond remain ordered by UUID.
  const order = view === 'now' ? sql`date_trunc('milliseconds',s.created_at)` : sql`date_trunc('milliseconds',s.updated_at)`;
  const rows = await sql<{id:string;work_id:string;format:string;location:ReadingLocation|null;created_at:Date;updated_at:Date;ended_at:Date|null;title:string;username:string;avatar:string|null;server:string}[]>`
    select s.id,s.work_id,s.format,s.location,s.created_at,s.updated_at,
      case when coalesce((${active()}),false) then null else coalesce(s.closed_at,least(s.updated_at,s.expires_at)) end as ended_at,
      w.title,u.username,case when social_visible(u.id,${userId}::uuid,'details') then u.settings->'profile'->>'avatar' end as avatar,
      coalesce(i.name,'Local file') as server
    from reading_sessions s join users u on u.id=s.user_id join reading_works w on w.id=s.work_id
    left join provider_connections c on c.id=s.connection_id
    left join provider_instances i on i.id=c.instance_id
    where ${eligible(userId)} and ${view === 'now' ? active() : sql`not coalesce((${active()}),false)`}
      ${beforeTime ? sql`and (${order},s.id)<(${beforeTime}::timestamptz,${beforeId}::uuid)` : sql``}
    order by ${order} desc,s.id desc limit 21`;
  const cards = new Map((await workCards(userId,userId,[...new Set(rows.map(row=>row.work_id))])).map(card=>['workId' in card?card.workId??card.id:card.id,card]));
  return rows.flatMap(row=>{
    const card = cards.get(row.work_id);
    if (!card) return [];
    const location = row.location;
    const position = location ? location.format === 'epub' ? location.fraction : location.page : 0;
    const duration = location ? location.format === 'epub' ? 1 : location.total : 0;
    return [{id:row.id,deviceId:null,externalId:row.work_id,externalUserId:null,mediaType:'Book',
      username:row.username,title:row.title,episode:null,client:'Coast',device:null,paused:false,
      method:`${row.format.toUpperCase()} reader`,duration,position,progress:duration>0?Math.min(1,position/duration):null,
      firstSeenAt:new Date(row.created_at).toISOString(),lastSeenAt:new Date(row.updated_at).toISOString(),
      endedAt:row.ended_at?new Date(row.ended_at).toISOString():null,server:row.server,connectionId:null,
      reading:location,card,actor:{username:row.username,avatar:row.avatar,profileHref:profilePath(row.username)}}];
  });
}
