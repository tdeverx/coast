import {getSql} from '#lib/server/db/index.js';
type SharedStreamRow={id:string;share_id:string;owner_id:string;username:string;client:string;first_seen_at:Date;last_seen_at:Date;ended_at:Date|null;provider_device_id:string|null;media_type:string;position_seconds:number;duration_seconds:number|null;max_bitrate:number|null;state:string;external_id:string;instance_id:string;connection_id:string;server:string;title:string;season_number:number|null;episode_number:number|null;viewers:number};

/** Same stable keyset cursor as server session history; no tokens or addresses enter this read model. */
export async function sharedStreamRows(view:'now'|'history',before?:string) {
 const db=getSql(),[date,id]=before?.split('|')??[];
 const active=db`i.enabled and c.status='connected' and c.account_generation=s.account_generation and not u.disabled and (u.role='admin' or coalesce(u.settings->>'allowPlaybackSharing'='true',false)) and coalesce((select (value->>'allowPlaybackSharing')::boolean from system_settings where key='coast'),false) and v.playback_id=p.id and v.ended_at is null and v.last_seen_at>now()-interval '90 seconds' and s.revoked_at is null and s.expires_at>now() and p.state<>'stopped'`;
 const last=view==='history'?db`p.updated_at`:db`v.last_seen_at`;
 const order=view==='now'?db`p.created_at`:last;
 return db<SharedStreamRow[]>`select p.id,s.id as share_id,s.owner_id,u.username,v.client,p.created_at as first_seen_at,${last} as last_seen_at,
 case when ${active} then null else case when v.playback_id=p.id then coalesce(v.ended_at,v.last_seen_at) else p.updated_at end end as ended_at,
 p.provider_device_id,p.media_type,p.position_seconds,p.duration_seconds,p.max_bitrate,p.state,
 pi.external_id,c.instance_id,c.id as connection_id,i.name as server,coalesce(sh.title,m.title,mw.title,'Shared item') as title,
 e.season_number,e.episode_number,
 (select count(*)::int from share_viewers others join playback_sessions other_playback on other_playback.id=others.playback_id where others.share_id=s.id and others.ended_at is null and others.last_seen_at>now()-interval '90 seconds' and other_playback.state<>'stopped') as viewers
 from playback_sessions p join share_viewers v on v.id=p.share_viewer_id join playback_shares s on s.id=p.share_id join users u on u.id=s.owner_id join provider_items pi on pi.id=p.provider_item_id
 join provider_connections c on c.id=s.connection_id join provider_instances i on i.id=c.instance_id
 left join media m on m.id=s.work_id left join music_works mw on mw.id=s.work_id
 left join episodes e on e.media_id=s.work_id left join media sh on sh.id=e.show_id
 where ${last} is not null and ${view==='now'?active:db`not (${active})`}
 ${date?db`and (${order},p.id)<(${date}::timestamptz,${id}::uuid)`:db``}
 order by ${order} desc,p.id desc limit 21`;
}
export async function sharedStreamCount(){
 const [row]=await getSql()`select count(*)::int as total from share_viewers v join playback_shares s on s.id=v.share_id join playback_sessions p on p.id=v.playback_id join users u on u.id=s.owner_id join provider_connections c on c.id=s.connection_id join provider_instances i on i.id=c.instance_id where i.enabled and c.status='connected' and c.account_generation=s.account_generation and not u.disabled and (u.role='admin' or coalesce(u.settings->>'allowPlaybackSharing'='true',false)) and coalesce((select (value->>'allowPlaybackSharing')::boolean from system_settings where key='coast'),false) and v.ended_at is null and v.last_seen_at>now()-interval '90 seconds' and s.revoked_at is null and s.expires_at>now() and p.state<>'stopped'`;
 return row.total as number;
}
/** Exclude any server observation already represented by a Coast viewer lease. */
export function excludingSharedDevice(db:ReturnType<typeof getSql>){return db`not exists(select 1 from playback_sessions shared_playback where shared_playback.share_id is not null and shared_playback.provider_device_id=snapshot->>'deviceId')`;}
