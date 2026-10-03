import * as v from 'valibot';
import { getSql } from '$lib/server/db';
import { audiences } from './model';
import { activityStatus, statusPreferences, type StatusPreference } from './status';

// u/up are the user and presence aliases in the bounded friend roster query.
export function friendStatusSql(viewerId: string) {
 return getSql()`case
 when not social_visible(u.id,${viewerId}::uuid,'presence') or coalesce(u.settings->>'activityStatus','automatic')='invisible'
 or up.heartbeat_at is null or up.heartbeat_at<=now()-interval '90 seconds' then 'offline'
 when u.settings->>'activityStatus' in ('away','busy') then u.settings->>'activityStatus'
 when up.active_at>now()-interval '5 minutes' then 'online' else 'away' end`;
}
async function ownStatus(userId: string) {
 const [row] = await getSql()`select coalesce(u.settings->>'activityStatus','automatic') as preference,u.settings,up.heartbeat_at,up.active_at
 from users u left join user_presence up on up.user_id=u.id where u.id=${userId}`;
 const preference = row.preference as StatusPreference;
 return { preference, sharePresence:(row.settings?.social?.sections?.presence??row.settings?.social?.audience??'friends')!=='private', status: activityStatus(preference,row.heartbeat_at ? new Date(row.heartbeat_at).getTime() : null,row.active_at ? new Date(row.active_at).getTime() : null,Date.now()) };
}
export async function heartbeat(userId: string, raw: unknown) {
 const {active} = v.parse(v.object({active:v.boolean()}),raw);
 await getSql()`insert into user_presence(user_id,heartbeat_at,active_at) values(${userId},now(),case when ${active} then now() end)
 on conflict(user_id) do update set heartbeat_at=now(),active_at=case when ${active} then now() else user_presence.active_at end
 where user_presence.heartbeat_at<now()-interval '10 seconds' or (${active} and (user_presence.active_at is null or user_presence.active_at<now()-interval '10 seconds'))`;
 return ownStatus(userId);
}
export async function setStatus(userId: string, raw: unknown) {
 const {preference} = v.parse(v.object({preference:v.picklist(statusPreferences)}),raw);
 await getSql()`update users set settings=jsonb_set(settings,'{activityStatus}',to_jsonb(${preference}::text)) where id=${userId}`;
 return ownStatus(userId);
}

export async function statusesForUsers(viewerId: string, ids: string[]) {
 if(!ids.length)return {};
 const db=getSql();
 const rows=await db`select u.id,${friendStatusSql(viewerId)} as status from users u left join user_presence up on up.user_id=u.id
 where u.id in ${db([...new Set(ids)])} and not u.disabled`;
 return Object.fromEntries(rows.map((row:{id:string;status:import('./status').ActivityStatus})=>[row.id,row.status])) as Record<string,import('./status').ActivityStatus>;
}

export async function setPresenceSharing(userId: string, raw: unknown) {
 const {enabled}=v.parse(v.object({enabled:v.boolean()}),raw);
 await getSql().begin(async db=>{
  const [row]=await db`select settings from users where id=${userId} for update`;
  const settings=row.settings;
  const current=settings.social?.sections?.presence??settings.social?.audience??'friends';
  const remembered=v.safeParse(v.picklist(audiences),settings.presenceAudience);
  const audience=enabled?(remembered.success&&remembered.output!=='private'?remembered.output:current!=='private'?current:'friends'):'private';
  const social={...settings.social,sections:{...settings.social?.sections,presence:audience}};
  const patch={social,...(!enabled&&current!=='private'?{presenceAudience:current}:{})};
  await db`update users set settings=settings||${patch}::jsonb where id=${userId}`;
 });
 return ownStatus(userId);
}
