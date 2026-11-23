// bun implicit-evidence.ts <username> [private-session-input.json]
// Use DATABASE_URL for a local research copy. Only write aggregates to stdout.
import {SQL} from 'bun';
import {writeFile} from 'node:fs/promises';
const [username,output]=Bun.argv.slice(2);
const url=new URL(process.env.DATABASE_URL??'');
if(!username||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Expected a username and local research database.');
const db=new SQL(url.href,{max:1});
try {
 await db.begin('read only',async sql=>{
  await sql`set local statement_timeout='45s'`;
  const [user]=await sql`select id from users where username=${username} and not disabled`;
  if(!user)throw Error('Unknown user.');
  // Filter after LAG, exactly as in interests.server.ts. Preserve all independent plays.
  const watches=await sql`with sequenced as (
   select e.media_id,e.action,e.source,e.rewatch,e.occurred_at,e.occurred_at_known,
    lag(e.action) over(partition by e.media_id order by e.created_at,e.id) as previous_action
   from tracking_events e where user_id=${user.id} and applied and action in ('watch','unwatch')
    and (action='unwatch' or value is distinct from false)
  )
  select s.media_id,w.kind,coalesce(ep.show_id,s.media_id) as root,ep.season_number,ep.episode_number,
   coalesce(ep.is_special,false) as special,s.source,s.occurred_at as at,m.release_date as release
  from sequenced s join media m on m.id=s.media_id join works w on w.id=s.media_id
   left join episodes ep on ep.media_id=s.media_id
  where s.action='watch' and s.occurred_at_known and (s.rewatch or s.previous_action is distinct from 'watch')
   and w.kind in ('movie','episode') order by s.occurred_at,s.media_id`;
  const census=await sql`select e.show_id as root,e.season_number as season,e.episode_number as episode,m.release_date as release
   from episodes e join media m on m.id=e.media_id where m.release_date is not null and e.season_number>0 and not e.is_special
   and exists(select 1 from tracking_events t join episodes ep on ep.media_id=t.media_id
    where t.user_id=${user.id} and t.action='watch' and t.applied and ep.show_id=e.show_id)`;

  const counts=new Map<string,Map<string,Map<string,number>>>();
  const timestamps=new Map<string,number>();
  const releaseClocks=new Map<string,number>();
  for(const row of watches){
   const at=new Date(row.at).toISOString();
   const times=counts.get(row.media_id)??new Map<string,Map<string,number>>();
   const src=times.get(at)??new Map<string,number>();
   src.set(row.source,(src.get(row.source)??0)+1);
   times.set(at,src);counts.set(row.media_id,times);
   timestamps.set(at,(timestamps.get(at)??0)+1);
   if(row.kind==='movie' && row.release && at.slice(0,10)===new Date(row.release).toISOString().slice(0,10)){
    const clock=at.slice(11,16);releaseClocks.set(clock,(releaseClocks.get(clock)??0)+1);
   }
  }
  let corrected=0,removedDuplicateEvidence=0;
  for(const times of counts.values()){
   let before=0,after=0;
   for(const sources of times.values()){
    const jellyfin=sources.get('jellyfin')??0,trakt=sources.get('trakt')??0;
    const independent=[...sources].filter(([s])=>s!=='jellyfin'&&s!=='trakt').reduce((n,[,x])=>n+x,0);
    before+=Math.max(jellyfin,trakt)+independent;
    after+=Math.max(Math.min(jellyfin,1),trakt)+independent;
   }
   if(before!==after){corrected++;removedDuplicateEvidence+=before-after;}
  }
  const coverage=await sql`select (select count(*)::int from rewatches where user_id=${user.id}) as saved_rewatch_starts,
   (select count(*)::int from tracking_state t join media m on m.id=t.media_id where t.user_id=${user.id} and t.dropped) as dropped,
   count(*)::int as player_sessions,count(*) filter(where share_id is not null)::int as shared_sessions,
   count(*) filter(where share_id is null and played_seconds>300)::int as personal_sessions_over_five_minutes
   from playback_sessions where user_id=${user.id}`;
  console.log(JSON.stringify({knownMovieOrEpisodeMarks:watches.length,worksWithCorrectedEventCount:corrected,removedDuplicateEvidence,
   watchesInGroupsOfThreeOrMore:[...timestamps.values()].filter(n=>n>=3).reduce((a,b)=>a+b,0),sameReleaseDayMovieClocks:Object.fromEntries(releaseClocks),coverage:coverage[0]},null,2));
  if(output){
   const films=await sql`select r.parent_id as family,r.child_id as work,m.release_date as release
    from media_relationships r join media m on m.id=r.child_id and m.kind='movie'
    where r.kind in ('collection','franchise') and m.release_date is not null`;
   const decisions=await sql`select t.media_id as work,t.action,t.value,t.occurred_at_known as known,
    t.occurred_at as at,t.created_at as recorded from tracking_events t join media m on m.id=t.media_id
    where t.user_id=${user.id} and t.applied and t.action in ('favourite','drop','restore','pause','resume')
     and m.kind in ('movie','show') order by t.created_at,t.id`;
   await writeFile(output,JSON.stringify({watches,census,films,decisions}),{flag:'wx',mode:0o600});
  }
 });
}finally{await db.close();}
