import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as v from 'valibot';
import {getSql} from '#lib/server/db/index.js';
import {trackReadQuery,withReadCancellation} from '#lib/server/db/read-cancellation.js';
import {requireFeature} from '#lib/server/features.js';
import {AppError} from '#lib/server/security/errors.js';
import {tasteRootJoin} from './taste-root.server';
import {workTasteFeatures} from './work-features.server';
import {compareFriendItemV2, validatedFriendContextV2} from './friend-taste-v2';

type Medium='movie'|'show';
type Access={id:string;ratings:boolean;activity:boolean;progress:boolean;favourites:boolean;collection:boolean;reactions:boolean;region:string};

function permittedFriends(viewer:string, friend?:string) {
  const sql=getSql();
  return sql`select friend.id,
    social_visible(friend.id,viewer.id,'ratings','screen') as ratings,
    social_visible(friend.id,viewer.id,'activity','screen') as activity,
    social_visible(friend.id,viewer.id,'progress','screen') as progress,
    social_visible(friend.id,viewer.id,'favourites','screen') as favourites,
    social_visible(friend.id,viewer.id,'collection','screen') as collection,
    social_visible(friend.id,viewer.id,'reactions','screen') as reactions,
    coalesce(nullif(viewer.settings->>'region',''),'GB') as region
    from users viewer join friendships link on viewer.id in (link.user_a,link.user_b) and link.state='accepted'
    join users friend on friend.id=case when link.user_a=viewer.id then link.user_b else link.user_a end
    where viewer.id=${viewer}::uuid ${friend?sql`and friend.id=${friend}::uuid`:sql``}
    and not viewer.disabled and not friend.disabled
    and coast_feature_enabled(viewer.id,'personalisation') and coast_feature_enabled(friend.id,'personalisation')
    and coast_feature_enabled(viewer.id,'social') and coast_feature_enabled(friend.id,'social')
    and social_visible(friend.id,viewer.id,'insights','screen')`;
}

async function friendAccess(viewer:string,friend:string) {
  const sql=getSql();
  const [access]=await trackReadQuery(()=>sql<Access[]>`select * from (${permittedFriends(viewer,friend)}) visible`);
  if (!access) throw new AppError(404,'This taste comparison is private or unavailable.');
  return access;
}

const studySchema=v.object({
  viewerId:v.pipe(v.string(),v.uuid()),friendId:v.pipe(v.string(),v.uuid()),medium:v.picklist(['movie','show']),
  forecasts:v.array(v.object({id:v.pipe(v.string(),v.uuid()),personal:v.number(),friendStars:v.nullable(v.number()),viewerStars:v.number(),
    predictedAt:v.string(),friendObservedAt:v.string(),viewerRatedAt:v.string(),genres:v.optional(v.array(v.string())),franchise:v.optional(v.string())})),
});
export type PrivatePeerStudyV2 = v.InferOutput<typeof studySchema>;

async function privateStudies() {
  const file=process.env.COAST_TASTE_V2_PEER_STUDY;
  if (!file) return [];
  const info=await stat(file).catch((error:NodeJS.ErrnoException)=>{
    if(error.code==='ENOENT')return null;
    throw error;
  });
  if (!info) return [];
  if (!info.isFile() || (info.mode&0o077)!==0) throw new Error('The private paired taste study must be an owner-only regular file.');
  const ledger=v.parse(v.object({version:v.literal(1),modelHash:v.string(),studies:v.array(studySchema)}),JSON.parse(await readFile(file,'utf8')));
  // This optional preview study is tied to the exact code that made the frozen personal forecasts.
  const modelHash=createHash('sha256').update(await readFile('src/lib/social/taste-v2.ts')).digest('hex');
  return ledger.modelHash===modelHash?ledger.studies:[];
}

type PeerOutcome={id:string;rating:number|null;watched:boolean};
async function eligiblePeerOutcomes(viewer:string,root:string,medium:Medium) {
  const sql=getSql();
  return trackReadQuery(()=>sql<PeerOutcome[]>`
    with access as materialized (${permittedFriends(viewer)})
    select a.id,r.value::float8 as rating,
      coalesce(t.watched or t.play_count>0 or t.completed_episodes>0,false) as watched
    from access a join works w on w.id=${root}::uuid and w.category='screen' and w.kind=${medium}
    left join ratings r on a.ratings and r.user_id=a.id and r.media_id=w.id
    left join tracking_state t on a.activity and t.user_id=a.id and t.media_id=w.id
    where r.value is not null or t.watched or t.play_count>0 or t.completed_episodes>0 order by a.id`);
}

async function currentForecasts(study:PrivatePeerStudyV2,root:string,kind:'rating'|'watch') {
  const sql=getSql();
  const forecasts=study.forecasts.filter(row=>row.id!==root&&(kind==='watch'?row.friendStars===null:row.friendStars!==null));
  const ids=[...new Set(forecasts.map(row=>row.id))];
  if (!ids.length) return [];
  const rows=await trackReadQuery(()=>sql<{id:string;mine:number;theirs:number|null;watched:boolean}[]>`
    with access as materialized (${permittedFriends(study.viewerId,study.friendId)})
    select w.id,mine.value::float8 as mine,theirs.value::float8 as theirs,
      coalesce(t.watched or t.play_count>0 or t.completed_episodes>0,false) as watched
    from access a join works w on w.kind=${study.medium} and w.id=any(${sql.array(ids,'UUID')}::uuid[])
    join ratings mine on mine.media_id=w.id and mine.user_id=${study.viewerId}
    left join ratings theirs on a.ratings and theirs.media_id=w.id and theirs.user_id=a.id
    left join tracking_state t on a.activity and t.media_id=w.id and t.user_id=a.id`);
  const current=new Map(rows.map(row=>[row.id,row]));
  return forecasts.filter(row=>{
    const now=current.get(row.id);
    return now&&now.mine===row.viewerStars&&(kind==='watch'?now.watched:now.theirs===row.friendStars);
  });
}

/** Only explicit private preview inspections call this. No influence is admitted without independently
 * consented prospective observations. Clearing a rating, changing privacy or removing the file withdraws it. */
export async function friendItemSignalsV2(viewer:string,root:string,medium:Medium,personalScore:number|null,signal?:AbortSignal,
  studyOverride?:readonly PrivatePeerStudyV2[]) {
  return withReadCancellation(signal,async()=>{
    const peers=await eligiblePeerOutcomes(viewer,root,medium);
    let studyUnavailable=false;
    const studies=peers.length&&personalScore!==null?(studyOverride??await privateStudies().catch(()=>{
      studyUnavailable=true;
      return [];
    })):[];
    const byId=new Map(peers.map(row=>[row.id,row]));
    const eligible=studies.filter(study=>study.viewerId===viewer&&study.medium===medium&&byId.has(study.friendId));
    let genres:string[]=[];
    if (eligible.some(study=>study.forecasts.some(forecast=>forecast.genres?.length))) {
      const config=await requireFeature(viewer,'personalisation');
      const features=await workTasteFeatures([root],config.metadataSource);
      genres=features.get(root)?.genres?.map(feature=>feature.id)??[];
    }
    // Use one independently validated peer. Friends in the same social circle are not independent votes.
    let best:ReturnType<typeof compareFriendItemV2>|undefined,scope:'medium'|'genres'|null=null,evaluated=false;
    for (const study of eligible) {
      const peer=byId.get(study.friendId)!;
      const kind=peer.rating===null?'watch':'rating';
      const records=await currentForecasts(study,root,kind);
      const checked=validatedFriendContextV2(records,root,kind,genres);
      const candidate=compareFriendItemV2(personalScore,peer.rating,checked.gate,peer.watched);
      evaluated ||= checked.gate.state==='no-measured-gain';
      if (candidate.assistedScore!==null&&(!best||candidate.calibrationWorks>best.calibrationWorks)) {
        best=candidate;scope=checked.scope;
      }
    }
    if (studies.length) {
      const latest=await eligiblePeerOutcomes(viewer,root,medium);
      if (JSON.stringify(peers)!==JSON.stringify(latest)) throw new AppError(404,'Sharing settings changed. Reopen this taste comparison.');
    }
    return {personalScore,assistedScore:best?.assistedScore??null,scope,visibleRatings:peers.filter(p=>p.rating!==null).length,
      visibleWatches:peers.filter(p=>p.watched).length,calibrationWorks:best?.calibrationWorks??0,
      reason:best?.reason??(personalScore===null?'no-personal-score':!peers.length?'no-visible-opinion':studyUnavailable?'study-unavailable':evaluated?'no-measured-gain':'insufficient-evidence')};
  });
}


/** The offline freeze owns this read. Store the visible peer evidence before either the viewer's rating
 * or later edits to a friend's opinion can be mistaken for what was available at prediction time. */
export async function snapshotFriendOutcomesV2(viewer:string,friend:string) {
  await friendAccess(viewer,friend);
  const sql=getSql();
  return trackReadQuery(()=>sql<{id:string;medium:Medium;stars:number|null;watched:boolean}[]>`
    with access as materialized (${permittedFriends(viewer,friend)}), eligible as (
      select r.media_id as id,r.value::float8 as stars,false as watched from access a join ratings r on a.ratings and r.user_id=a.id
      union all
      select t.media_id,null::float8,true from access a join tracking_state t on a.activity and t.user_id=a.id
      where t.watched or t.play_count>0 or t.completed_episodes>0
    ), own_inputs as (
      select media_id as id from ratings where user_id=${viewer}
      union select media_id from tracking_state where user_id=${viewer}
        and (favourite or dropped or paused or collected or watchlist or watched or play_count>0 or completed_episodes>0 or position_seconds>0)
    ), known as (
      select distinct root.id from own_inputs o join works w on w.id=o.id ${tasteRootJoin(sql)}
    ) select w.id,w.kind as medium,max(p.stars) as stars,bool_or(p.watched) as watched from eligible p
    join works w on w.id=p.id and w.kind in ('movie','show') where not exists(select 1 from known k where k.id=w.id)
    group by w.id,w.kind order by w.id`);
}
