import { getSql } from '$lib/server/db';
import { featureValues, type FeatureConfiguration } from '$lib/features';
import { jobCheckpoint, readJobCheckpoint, saveJobCheckpoint } from '$lib/server/queue/execution';
import type { OutboxAction } from '$lib/server/queue';

/** Durable, bounded local withdrawal; no provider I/O in the settings transaction. */
export async function queueFeatureTransition(db: ReturnType<typeof getSql>, actorId: string, config: FeatureConfiguration, subjectId?: string, choices?:import('$lib/features').FeatureChoices) {
  const [work]=await db`select exists(select 1 from playback_sessions where state<>'stopped' and (${subjectId??null}::uuid is null or user_id=${subjectId??null}::uuid))
    or exists(select 1 from reading_sessions where closed_at is null and (${subjectId??null}::uuid is null or user_id=${subjectId??null}::uuid))
    or exists(select 1 from synced_rooms where ended_at is null and (${subjectId??null}::uuid is null or host_id=${subjectId??null}::uuid))
    or exists(select 1 from synced_participants where joined and (${subjectId??null}::uuid is null or user_id=${subjectId??null}::uuid))
    or exists(select 1 from user_presence where ${subjectId??null}::uuid is null or user_id=${subjectId??null}::uuid)
    or exists(select 1 from social_live_state s join provider_connections c on c.id=s.connection_id where ${subjectId??null}::uuid is null or c.user_id=${subjectId??null}::uuid)
    or exists(select 1 from social_checkins where state='active' and (${subjectId??null}::uuid is null or user_id=${subjectId??null}::uuid))
    or exists(select 1 from outbox_actions where state in ('pending','running','failed') and kind in ('webhook.deliver','planning.reminder','jellyfin.sync','catalogue.user-scan','tmdb.refresh','trakt.import','trakt.lists-import','trakt.export','trakt.list-export','trakt.progress','trakt.collection-project','trakt.collection-review','jellyfin.live','steam.live','trakt.live','trakt.scrobble','trakt.checkin','social.checkin-complete','seerr.request','seerr.sync','steam.sync','steam.achievements','igdb.steam-metadata','trakt.recommendations','tmdb.recommendations','igdb.recommendations','taste.refresh') and (${subjectId??null}::uuid is null or user_id=${subjectId??null}::uuid)) as needed`;
  if(!work.needed)return;
  config={features:config.features,experimentalMusic:config.experimentalMusic,experimentalGaming:config.experimentalGaming,experimentalBooks:config.experimentalBooks,experimentalComics:config.experimentalComics,experimentalParties:config.experimentalParties,experimentalPlanning:config.experimentalPlanning,allowPlaybackSharing:config.allowPlaybackSharing,enableRequests:config.enableRequests};
  await db`insert into outbox_actions(user_id,kind,payload) values(${actorId},'feature.reconcile',${{config,subjectId,choices,_jobPurpose:'interactive'}}::jsonb||jsonb_build_object('cutoff',clock_timestamp()))`;
}
export async function reconcileFeatures(action: OutboxAction) {
  const config=action.payload.config as FeatureConfiguration, cutoff=String(action.payload.cutoff);
  const subjectId=typeof action.payload.subjectId==='string'?action.payload.subjectId:null;
  const checkpoint=await readJobCheckpoint();
  let after=typeof checkpoint?.after==='string'?checkpoint.after:null, checked=Number(checkpoint?.checked??0);
  while(true){
    const db=getSql();
    const users=await db<{id:string;settings:{features?:import('$lib/features').FeatureChoices}}[]>`select id,settings from users where (${subjectId}::uuid is null or id=${subjectId}::uuid) and (${after}::uuid is null or id>${after}::uuid) order by id limit 40`;
    if(!users.length)return {checked};
    for(const user of users){
      const features=featureValues(config,subjectId?action.payload.choices as import('$lib/features').FeatureChoices:user.settings.features);
      let more:boolean;do{
      more=await db.begin(async tx=>{
        await tx`select pg_advisory_xact_lock(hashtextextended(${user.id},0))`;
        let checkinChanges=0;
        if(!features.presence){
          await tx`delete from user_presence where user_id=${user.id}`;
          await tx`delete from social_live_state where connection_id in(select id from provider_connections where user_id=${user.id}) and checked_at<=${cutoff}::timestamptz`;
          const checkins=await tx`update social_checkins set state='cancelled',updated_at=now() where id in(select id from social_checkins where user_id=${user.id} and state='active' and created_at<=${cutoff}::timestamptz order by id limit 100) returning id`;
          checkinChanges=checkins.length;
          if(checkins.length)await tx`insert into outbox_actions(user_id,connection_id,account_generation,kind,payload)
            select ${user.id}::uuid,c.id,c.account_generation,'trakt.checkin',jsonb_build_object('checkinId',d.checkin_id,'_jobPurpose','playback')
            from social_live_deliveries d join provider_connections c on c.id=d.connection_id
            where d.checkin_id in ${tx(checkins.map((checkin:{id:string})=>checkin.id))} and c.user_id=${user.id} and c.status='connected' and c.account_generation=d.account_generation and d.state in ('started','uncertain')`;

        }
        let roomChanges=0, participantChanges=0;
        {
          const rooms=await tx`update synced_rooms set ended_at=now(),revision=revision+1 where id in(select r.id from synced_rooms r left join works w on w.id=r.media_id where r.host_id=${user.id} and r.ended_at is null and r.created_at<=${cutoff}::timestamptz and (not ${features.parties} or r.media_type='reading' and (not ${features.reader} or w.category='book' and not ${features.book} or w.category='comic' and not ${features.comic}) or r.media_type<>'reading' and (not ${features.playback} or r.media_type='audio' and not ${features.music} or r.media_type<>'audio' and not ${features.screen})) order by r.id limit 100) returning id`;
          roomChanges=rooms.length;
          const members=await tx`update synced_participants set joined=false,buffering=false,playback_id=null,reading_session_id=null
            where (room_id,user_id) in(select p.room_id,p.user_id from synced_participants p join synced_rooms r on r.id=p.room_id
              where p.user_id=${user.id} and p.joined and p.heartbeat_at<=${cutoff}::timestamptz
                and (not ${features.parties} or r.ended_at is not null or exists(select 1 from works w where w.id=r.media_id and
                  (w.category='screen' and (not ${features.playback} or not ${features.screen})
                    or w.category='music' and (not ${features.playback} or not ${features.music})
                    or w.category='book' and (not ${features.reader} or not ${features.book})
                    or w.category='comic' and (not ${features.reader} or not ${features.comic}))))
              order by p.room_id limit 100) returning room_id`;
          participantChanges=members.length;
        }
        const readers=await tx`update reading_sessions r set closed_at=now() where r.id in(select r.id from reading_sessions r join works w on r.work_id=w.id where r.user_id=${user.id} and r.closed_at is null and r.created_at<=${cutoff}::timestamptz and (not ${features.reader} or w.category='book' and not ${features.book} or w.category='comic' and not ${features.comic}) order by r.id limit 100) returning r.id`;
        const stopped=await tx`update playback_sessions set state='stopped',updated_at=now(),cleanup_pending=(share_id is not null) where id in(select id from playback_sessions where user_id=${user.id} and state<>'stopped' and created_at<=${cutoff}::timestamptz and (not ${features.playback} or media_type='audio' and not ${features.music} or media_type<>'audio' and not ${features.screen} or share_id is not null and not ${features.sharing}) order by id limit 100) returning *`;
        for(const session of stopped)if(!session.share_id)await tx`insert into outbox_actions(user_id,connection_id,account_generation,kind,payload) values(${user.id},${session.connection_id},${session.account_generation},'jellyfin.scrobble',${{sessionId:session.id,event:'stop',positionSeconds:session.position_seconds,paused:true,_jobPurpose:'playback'}}::jsonb)`;
        // Withdraw unsent work, preserving its durable history and checkpoint. A reenabling cannot replay it.
        const kinds=[...(!features.api?['webhook.deliver']:[]),...(!features.planning?['planning.reminder']:[]),...(!features.presence?['jellyfin.live','steam.live','trakt.live','trakt.scrobble','trakt.checkin','social.checkin-complete']:[]),...(!features.screen?['seerr.request','catalogue.user-scan','trakt.import','trakt.lists-import','trakt.export','trakt.list-export','trakt.progress','trakt.collection-project','trakt.collection-review']:[]),...(!features.game?['steam.sync','steam.achievements']:[]),...(!features.personalisation?['trakt.recommendations']:[]),...(config.features?.screen===false?['tmdb.refresh','tmdb.recommendations']:[]),...(config.experimentalGaming===false?['igdb.steam-metadata']:[]),...(config.features?.personalisation===false?['tmdb.recommendations','igdb.recommendations','taste.refresh']:[]),...(!features.requests?['seerr.request','seerr.sync']:[])];
        const cancelled=kinds.length?await tx`update outbox_actions set state='cancelled',locked_at=null,last_error='Disabled in feature settings.',updated_at=now() where id in(select id from outbox_actions where user_id=${user.id} and kind in ${tx(kinds)} and state in ('pending','failed') and not (kind='trakt.checkin' and exists(select 1 from social_checkins c where c.user_id=${user.id} and c.id::text=outbox_actions.payload->>'checkinId' and c.state<>'active')) and created_at<=${cutoff}::timestamptz order by id limit 100) returning id`:[];
        return Math.max(readers.length,stopped.length,cancelled.length,roomChanges,participantChanges,checkinChanges)>=100;
      });
      if(more)await jobCheckpoint();
      }while(more);
      after=user.id;checked++;
      await saveJobCheckpoint({after,checked});
      await jobCheckpoint();
    }
  }
}
