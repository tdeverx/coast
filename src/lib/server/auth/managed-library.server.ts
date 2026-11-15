import type { MediaCardPresentation, MediaView } from '#lib/ui/types.js';
import { checkLoginRate } from './index';
import { connectJellyfin } from '#lib/providers/jellyfin/connection.server.js';
import { getSql } from '../db';
import { AppError } from '../security/errors';
import { is, maxLength, parse, pipe, string, uuid } from 'valibot';

const validId = pipe(string(),uuid());
const pageSize = 60;
type ScreenKind='movie'|'show'|'season'|'episode';
type OtherKind='album'|'track'|'book'|'comic';
type LibraryCard = {id:string;title:string;year:number|null;kind:ScreenKind|OtherKind;poster:string|null;showId:string|null;position:number;duration:number};
const observation = (db:ReturnType<typeof getSql>, userId:string) => db`
  select a.media_id,a.provider_item_id,a.connection_id,p.external_id,p.instance_id,p.kind,a.duration_seconds
  from scope c
  join availability a on a.user_id=${userId} and a.connection_id=c.connection_id and a.state='available'
  join provider_items p on p.id=a.provider_item_id and p.instance_id=c.instance_id
  where coast_managed_observation(a.source,a.verified_at,c.access_after)
`;

export async function managedLibrary(userId:string, search:URLSearchParams) {
  const db = getSql();
  const text = (search.get('q') ?? '').trim().slice(0,100);
  const continueOnly = search.get('view') === 'continue';
  const after = search.get('after');
  const cursor = is(validId,after) ? after : null;
  const rows = await db<LibraryCard[]>`
    with scope as materialized (select * from coast_managed_catalogue(${userId}::uuid)),
    gates as materialized (select coast_feature_enabled(${userId}::uuid,'screen') as screen,
      coast_feature_enabled(${userId}::uuid,'music') as music,coast_feature_enabled(${userId}::uuid,'book') as book,
      coast_feature_enabled(${userId}::uuid,'comic') as comic),
    observed as (${observation(db,userId)}),
    admitted as (
      select media_id as id from observed where kind in ('movie','episode','album','track','book','comic')
      union
      select e.show_id from observed o join episodes e on e.media_id=o.media_id where o.kind='episode' and not ${continueOnly}
    ), cursor_title as (
      select w.id,coalesce(m.title,audio.title,r.title) as title from works w
      left join media m on m.id=w.id left join music_works audio on audio.id=w.id left join reading_works r on r.id=w.id
      where w.id=${cursor}::uuid and exists(select 1 from admitted a where a.id=w.id)
        and coast_category_enabled(${userId}::uuid,w.category)
    ), titles as (
      select w.id,w.kind,coalesce(m.title,audio.title,r.title) as title,coalesce(m.year,audio.year,r.published_year) as year
      from admitted a join works w on w.id=a.id
      left join media m on m.id=w.id left join music_works audio on audio.id=w.id left join reading_works r on r.id=w.id
      cross join gates g
      where case w.category when 'screen' then g.screen when 'music' then g.music when 'book' then g.book when 'comic' then g.comic else false end
    ), page as materialized (
      select m.id,m.title,m.year,m.kind from titles m
      where (${text}='' or strpos(lower(m.title),lower(${text}))>0)
        and (${continueOnly} or m.kind<>'episode' or ${text}<>'')
        and (${cursor}::uuid is null or (lower(m.title),m.id)>(select lower(title),id from cursor_title))
        ${continueOnly ? db`and (
          exists(select 1 from tracking_state t where t.user_id=${userId} and t.media_id=m.id and t.position_seconds>0 and not t.watched)
          or exists(select 1 from music_progress mp where mp.user_id=${userId} and mp.track_id=m.id and mp.position_seconds>0)
          or exists(select 1 from reading_progress rp where rp.user_id=${userId} and rp.work_id=m.id and rp.state='reading')
        )` : db``}
      order by lower(m.title),m.id limit ${pageSize+1}
    )
    select page.*,e.show_id as "showId",
      coalesce(t.position_seconds,mp.position_seconds,0) as position,coalesce(t.duration_seconds,mp.duration_seconds,0) as duration,
      case when image.external_id is not null then '/api/v1/artwork/'||image.instance_id||'/'||image.external_id||'/primary' end as poster
    from page
    left join episodes e on e.media_id=page.id
    left join tracking_state t on t.user_id=${userId} and t.media_id=page.id
    left join music_progress mp on mp.user_id=${userId} and mp.track_id=page.id
    left join lateral (
      select c.instance_id,a.provider_item_id from scope c
      join availability a on a.user_id=${userId} and a.media_id=page.id and a.connection_id=c.connection_id and a.state='available'
      where coast_managed_observation(a.source,a.verified_at,c.access_after) order by a.provider_item_id limit 1
    ) candidate on true
    left join provider_items image on image.id=candidate.provider_item_id and image.instance_id=candidate.instance_id
    order by lower(page.title),page.id`;
  const items:(MediaView|MediaCardPresentation)[]=rows.slice(0,pageSize).map(row=>{
    const card={id:row.id,title:row.title,year:row.year,poster:row.poster,available:true};
    if(row.kind==='album'||row.kind==='track'||row.kind==='book'||row.kind==='comic')
      return {...card,kind:row.kind,href:'/media/'+row.id};
    return {...card,kind:row.kind,showId:row.showId??undefined,progress:row.position,duration:row.duration,watched:false,
      playCount:0,watchlist:false,favourite:false,collected:false,dropped:false,rating:null};
  });
  return {items,next:rows.length>pageSize ? rows[pageSize-1].id : null,query:text,continueOnly};
}

export async function managedDetails(userId:string, workId:string, after:string|null) {
  const db=getSql();
  const [work]=await db<{id:string;title:string;year:number|null;kind:ScreenKind|OtherKind;overview:string|null;position:number}[]>`
    select w.id,w.kind,coalesce(m.title,audio.title,r.title) as title,coalesce(m.year,audio.year,r.published_year) as year,
      coalesce(m.overview,audio.overview,r.overview) as overview,coalesce(t.position_seconds,mp.position_seconds,0) as position
    from works w left join media m on m.id=w.id left join music_works audio on audio.id=w.id left join reading_works r on r.id=w.id
    left join tracking_state t on t.user_id=${userId} and t.media_id=w.id
    left join music_progress mp on mp.user_id=${userId} and mp.track_id=w.id
    where w.id=${workId} and coast_category_enabled(${userId}::uuid,w.category) and coast_managed_work_visible(${userId}::uuid,w.id)`;
  if(!work)throw new AppError(404,'This title is unavailable in your library.');
  const cursor=is(validId,after) ? after : null;
  const episodes = work.kind!=='show'&&work.kind!=='season' ? [] : await db<{id:string;title:string;season:number;episode:number}[]>`
    with scope as materialized (select * from coast_managed_catalogue(${userId}::uuid)),
    observed as (${observation(db,userId)})
    select m.id,m.title,e.season_number as season,e.episode_number as episode
    from episodes e join media m on m.id=e.media_id left join seasons s on s.show_id=e.show_id and s.season_number=e.season_number
    where (e.show_id=${workId} or s.media_id=${workId}) and exists(select 1 from observed o where o.media_id=m.id and o.kind='episode')
      and (${cursor}::uuid is null or (e.season_number,e.episode_number,e.media_id)>(
        select season_number,episode_number,media_id from episodes
        where media_id=${cursor} and coast_managed_work_visible(${userId}::uuid,media_id)))
    order by e.season_number,e.episode_number,e.media_id limit ${pageSize+1}`;
  const tracks = work.kind!=='album' ? [] : await db<{id:string;title:string}[]>`
    select m.id,m.title from media_relationships r join music_works m on m.id=r.child_id and m.kind='track'
    where r.parent_id=${workId} and r.kind='contains' and coast_managed_work_visible(${userId}::uuid,m.id)
      and (${cursor}::uuid is null or (coalesce(r.position,0),m.id)>(
        select coalesce(position,0),child_id from media_relationships where parent_id=${workId} and kind='contains' and child_id=${cursor}
          and coast_managed_work_visible(${userId}::uuid,child_id)))
    order by coalesce(r.position,0),m.id limit ${pageSize+1}`;
  const list=work.kind==='album' ? tracks : episodes;
  return {work,episodes:episodes.slice(0,pageSize),tracks:tracks.slice(0,pageSize),next:list.length>pageSize ? list[pageSize-1].id : null};
}

/** Unknown surfaces stay closed for a restricted viewer, even when addressed directly. */
export function managedRoute(path:string, method:string) {
  if (['/','/library','/onboarding','/logout','/settings','/settings/account','/settings/appearance'].includes(path)) return true;
  if (/^\/media\/[0-9a-f-]{36}$/.test(path)) return method==='GET' || method==='HEAD';
  if (!path.startsWith('/api/v1/')) return false;
  if (/^\/api\/v1\/reading\/(?:[0-9a-f-]{36}\/session|sessions\/[0-9a-f-]{36}\/(?:manifest|file|pages\/[^/]+|heartbeat|location|close))$/.test(path))return true;
  return /^(?:session(?:\/(?:presence|heartbeat))?|playback(?:\/[0-9a-f-]{36}\/(?:error|progress|stream)(?:\/.*)?)?|artwork\/[0-9a-f-]{36}\/[0-9a-f-]{32,36}\/primary|member-invites(?:\/(?:request|[0-9a-f-]{36}))?|settings(?:\/(?:account|preferences|password))?|profile\/avatar\/[0-9a-f-]{36}\/[^/]+)$/.test(path.slice(8));
}


export async function reconnectManagedLibrary(userId:string,input:unknown) {
  const password=parse(pipe(string(),maxLength(4096)),input);
  checkLoginRate('managed-reconnect:'+userId);
  const [account]=await getSql()`select coalesce(member.username,u.username) as username,p.remote_id,authority.instance_id
    from users u join onboarding_provisioning p on p.user_id=u.id
    join provider_connections authority on authority.id=p.connection_id and authority.account_generation=p.account_generation
    left join provider_connections member on member.user_id=u.id and member.instance_id=authority.instance_id
    where u.id=${userId} and p.state='complete' and p.lifecycle in ('','active')
      and u.access_defaults->>'libraryOnly'='true' and coast_managed_schedule_open(p.active_defaults)`;
  if(!account?.remote_id)throw new AppError(403,'Your assigned Jellyfin account is not available. Contact an administrator.');
  await connectJellyfin(userId,{instanceId:account.instance_id,username:account.username,password},account.remote_id);
}


export async function managedReadingSource(userId:string,workId:string) {
  const db=getSql();
  const [source]=await db<{connectionId:string;externalId:string}[]>`
    select c.connection_id as "connectionId",p.external_id as "externalId" from coast_managed_catalogue(${userId}::uuid) c
    join availability a on a.connection_id=c.connection_id and a.user_id=${userId} and a.media_id=${workId} and a.state='available'
    join provider_items p on p.id=a.provider_item_id and p.instance_id=c.instance_id
    where p.kind in ('book','comic') and coast_managed_observation(a.source,a.verified_at,c.access_after)
    order by p.id limit 1`;
  if(!source)throw new AppError(404,'This edition is unavailable in your library.');
  return {source:'jellyfin',...source};
}

export async function requireManagedReadingSession(userId:string,id:string) {
  const db=getSql();
  const [source]=await db`select s.id from reading_sessions s
    join coast_managed_catalogue(${userId}::uuid) c on c.connection_id=s.connection_id
    join availability a on a.connection_id=c.connection_id and a.user_id=s.user_id and a.media_id=s.work_id and a.state='available'
    join provider_items p on p.id=a.provider_item_id and p.instance_id=c.instance_id
    where s.id=${id} and s.user_id=${userId} and replace(lower(p.external_id),'-','')=replace(lower(s.external_id),'-','')
      and coast_managed_observation(a.source,a.verified_at,c.access_after) limit 1`;
  if(!source)throw new AppError(404,'This reading session is no longer available.');
}
