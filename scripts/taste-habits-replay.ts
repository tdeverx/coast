// bun scripts/taste-habits-replay.ts <username> [private frozen capture] [--ratings]
// Outputs aggregates only. Intended for a read-only database copy.
import {readFile} from 'node:fs/promises';
import {getSql,closeDb} from '../src/lib/server/db';
import {scorerFromReference} from '../src/lib/social/taste-profile';
import {trainTasteMedium} from '../src/lib/social/taste-training';
import {captureTaste,evaluateSplit,summarize,workFold,type Prediction,type TasteReplayDataset} from './taste-replay';

type Row=TasteReplayDataset['history'][number];
type Work=Row['work'];
type Habit='returns'|'completion'|'drop'|'pace'|'binge'|'behind'|'endorsement'|'break';
type Arm='full'|'exposure only'|'with break'|Exclude<Habit,'break'>;

function ablate(work:Work,arm:Arm,breaks:Set<string>):Work {
  if(arm==='full')return work;
  if(arm==='with break')return breaks.has(work.id)&&work.consumed&&!work.dropped?{...work,repeated:true}:work;
  const w={...work},all=arm==='exposure only';
  if(all||arm==='returns'){w.deliberateReturn=false;w.repeated=false;if(w.implicit>3)w.implicit=3;}
  if(all||arm==='drop'){
    if(w.dropped&&w.completion===false)w.completion=null;
    if(w.implicit<0)w.implicit=w.consumed?3:0;
    w.dropped=false;
  }
  if(all||arm==='completion')w.completion=null;
  if(all||arm==='endorsement')w.explicit=0;
  if(all)w.watchHabits=null;
  else if(w.watchHabits&&(arm==='pace'||arm==='binge'||arm==='behind'))w.watchHabits={...w.watchHabits,[arm]:0};
  return w;
}

type Timeline={root:string; broadReturn:boolean; returned:boolean; resumed:boolean; dropped:boolean; finished:boolean; behind:number};
async function timelines(username:string,at:number){
  const sql=getSql(), cutoff=new Date(at);
  const rows=await sql<Timeline[]>`
    with raw as (
      select t.media_id as id,coalesce(e.show_id,t.media_id) as root,e.season_number,e.episode_number,
        m.release_date as released,t.action,t.rewatch,t.occurred_at as instant,
        lag(t.action) over(partition by t.media_id order by t.created_at,t.id) as previous
      from tracking_events t join users u on u.id=t.user_id and u.username=${username}
      join media m on m.id=t.media_id left join episodes e on e.media_id=t.media_id
      where t.applied and t.occurred_at_known and t.occurred_at<${cutoff} and t.action in ('watch','unwatch')
        and (t.action='unwatch' or t.value is distinct from false)
        and (m.kind='show' or e.season_number>0 and not e.is_special)
    ), plays as (
      select id,root,season_number,episode_number,released,min(instant) as first,max(instant) as last,count(distinct instant)::int as plays
      from raw where action='watch' and (rewatch or previous is distinct from 'watch')
      group by id,root,season_number,episode_number,released
    ), ordered as (
      select *,lag(first) over(partition by root order by first,id) as prior_watch from plays where id<>root
    ), frontiers as (
      select distinct on (root) root,season_number,episode_number,max(last) over(partition by root) as last_watch,count(*) over(partition by root) as seen
      from ordered order by root,season_number desc,episode_number desc
    ), episode_summary as (
      select root,count(*) filter(where plays>=2)>=2 and count(*) filter(where plays>=2)*3>=count(*) as broad_return,count(*) filter(where plays>=3)>=2 and count(*) filter(where plays>=3)*3>=count(*) as returned,
        bool_or(first-prior_watch>=interval '42 days' and released::timestamp at time zone 'UTC'<prior_watch-interval '1 day') as resumed
      from ordered group by root
    ), root_status as (
      select distinct on(t.media_id) t.media_id as root,t.action='drop' as dropped,t.action='pause' as paused
      from tracking_events t join users u on u.id=t.user_id and u.username=${username} join media m on m.id=t.media_id
      where m.kind='show' and t.applied and t.occurred_at_known and t.occurred_at<${cutoff}
        and t.action in ('drop','restore','pause','resume','watch','unwatch','progress')
      order by t.media_id,t.occurred_at desc,t.created_at desc,t.id desc
    ), arrivals as (
      select a.media_id,min((item.snapshot->>'addedAt')::timestamptz)
        filter(where pg_input_is_valid(item.snapshot->>'addedAt','timestamptz')) as available_since
      from availability a join users u on u.id=a.user_id and u.username=${username}
      join provider_items item on item.id=a.provider_item_id
      join provider_connections c on c.id=a.connection_id and c.user_id=u.id and c.status='connected'
      join provider_instances i on i.id=c.instance_id and i.provider='jellyfin' and i.enabled
      where a.state='available' group by a.media_id
    ), backlogs as (
      select f.root,least(count(*),4)::float8/4 as behind
      from frontiers f join episodes e on e.show_id=f.root and not e.is_special
        and (e.season_number,e.episode_number)>(f.season_number,f.episode_number)
      join media m on m.id=e.media_id left join root_status r on r.root=f.root left join arrivals a on a.media_id=e.media_id
      where f.seen>=2 and not coalesce(r.dropped or r.paused,false) and m.release_date is not null
        and greatest(m.release_date::timestamp at time zone 'UTC',a.available_since)>f.last_watch
        and greatest((m.release_date+1)::timestamp at time zone 'UTC',a.available_since)<=${cutoff}::timestamptz-interval '7 days'
        and not exists(select 1 from plays where id=e.media_id)
      group by f.root having count(*)>=2
    ), finished as (
      select id as root from raw where id=root group by id
      having (array_agg(action order by instant desc,case when action='unwatch' then 0 else 1 end))[1]='watch'
    ), ids as (
      select root from episode_summary union select root from root_status union select root from finished
    )
    select ids.root,coalesce(s.broad_return,false) or exists(select 1 from plays p where p.id=ids.root and p.plays>=2) as "broadReturn",coalesce(s.returned,false) as returned,
      coalesce(s.resumed,false) as resumed,coalesce(r.dropped,false) as dropped,f.root is not null as finished,coalesce(b.behind,0) as behind
    from ids left join backlogs b using(root) left join episode_summary s using(root) left join root_status r using(root) left join finished f using(root)`;
  return new Map(rows.map(row=>[row.root,row]));
}

async function genuineRatingDates(username:string){
  const sql=getSql();
  const rows=await sql<{root:string;instant:Date}[]>`with evidence as (
    select r.media_id,r.updated_at as instant from ratings r join users u on u.id=r.user_id and u.username=${username} where r.source='coast'
    union all select r.media_id,max((row.record->>'rated_at')::timestamptz) as instant from trakt_import_records row
    join trakt_import_stages s on s.id=row.stage_id and s.category='ratings' and s.phase='done'
    join provider_connections c on c.id=s.connection_id and c.account_generation=s.account_generation and c.status='connected'
    join provider_instances i on i.id=c.instance_id and i.enabled join users u on u.id=c.user_id and u.username=${username}
    join ratings r on r.user_id=u.id and r.media_id=row.observed_media_id and r.source='trakt'
    where row.applied and pg_input_is_valid(row.record->>'rated_at','timestamptz')
      and jsonb_typeof(row.record->'rating')='number' and (row.record->>'rating')::numeric=2*r.value
    group by r.media_id
  ) select m.id as root,max(instant) as instant from evidence join media m on m.id=evidence.media_id and m.kind='show'
    group by m.id`;
  return new Map(rows.map(row=>[row.root,+new Date(row.instant)]));
}

function historicalRows(data:TasteReplayDataset,cut:number,timeline:Map<string,Timeline>){
  const rows:Row[]=[];
  for(const row of data.history){
    const flags=timeline.get(row.work.id);
    if(!row.firstWatch||row.firstWatch>=cut)continue;
    const last=row.work.lastExperiencedAt?+new Date(row.work.lastExperiencedAt):0;
    // Retain complete pre-cutoff watch histories. A partial series could have acquired its binge or pace later.
    if(!last||last>=cut)continue;
    const dropped=flags?.dropped===true;
    rows.push({...row,work:{...row.work,rating:null,explicit:0,implicit:dropped?-2:flags?.broadReturn?4:3,
      consumed:true,chosen:true,dropped,repeated:!!flags?.broadReturn,deliberateReturn:!!flags?.returned,
      completion:dropped?false:flags?.finished?true:null,playtimeRank:null,lastRatedAt:null,
      watchHabits:{pace:row.work.watchHabits?.pace,binge:row.work.watchHabits?.binge,behind:flags?.behind}},credits:undefined});
  }
  return rows;
}

const pct=(x:number)=>Math.round(x*10000)/100;
/** Paired DeLong placements, within each fold on identical scorable titles. */
function paired(base:Map<string,Prediction>,folds:Prediction[][]){
  let credit=0,total=0,variance=0,defined=true;
  for(const fold of folds){
    const common=fold.filter(r=>r.score!==null&&base.get(r.id)?.score!=null);
    const yes=common.filter(r=>r.actual>=4),no=common.filter(r=>r.actual<=3);
    if(!yes.length||!no.length)continue;
    const lhs=new Float64Array(yes.length),rhs=new Float64Array(no.length);
    const win=(a:number,b:number)=>Number(a>b)+Number(a===b)*.5;
    let sum=0;
    for(const [i,a] of yes.entries())for(const [j,b] of no.entries()){
      const diff=win(a.rank,b.rank)-win(base.get(a.id)!.rank,base.get(b.id)!.rank);
      sum+=diff;lhs[i]+=diff/no.length;rhs[j]+=diff/yes.length;
    }
    const pairs=yes.length*no.length,mean=sum/pairs;
    const v=(xs:Float64Array)=>xs.reduce((n,x)=>n+(x-mean)**2,0)/(xs.length*(xs.length-1));
    defined&&=yes.length>1&&no.length>1;
    if(defined)variance+=pairs**2*(v(lhs)+v(rhs));
    total+=pairs;credit+=sum;
  }
  return {pairs:total,delta:total?pct(credit/total):null,interval95:defined&&total?[pct((credit-1.96*Math.sqrt(variance))/total),pct((credit+1.96*Math.sqrt(variance))/total)]:null};
}

function coverage(rows:Row[],breaks:Set<string>){
  const signals:Record<Habit,(w:Work)=>boolean>={returns:w=>!!(w.repeated||w.deliberateReturn),
    completion:w=>w.completion!=null,drop:w=>!!w.dropped,pace:w=>!!w.watchHabits?.pace,binge:w=>!!w.watchHabits?.binge,
    behind:w=>!!w.watchHabits?.behind,endorsement:w=>w.explicit>0,break:w=>breaks.has(w.id)};
  return Object.fromEntries(Object.entries(signals).map(([name,has])=>{
    const selected=rows.filter(r=>has(r.work)),decided=selected.filter(r=>r.work.rating!=null);
    return [name,{observed:selected.length,withRating:decided.length,high:decided.filter(r=>r.work.rating!>=4).length}];
  }));
}

export async function replayShowHabits(data:TasteReplayDataset,username:string,scorer=scorerFromReference,rated=false,trainer=trainTasteMedium){
  const known=data.history.filter(r=>r.work.rating!==null),dated=known.filter(r=>r.firstWatch&&r.work.lastExperiencedAt);
  const cut=dated.map(r=>r.firstWatch!).sort((a,b)=>a-b)[Math.floor(.75*dated.length)];
  if(data.medium!=='show'||!cut)throw Error('Need rated shows and dated watch history.');
  const [before,now,dates]=await Promise.all([timelines(username,cut),timelines(username,data.asOf+1),genuineRatingDates(username)]);
  const histories=historicalRows(data,cut,before),held=dated.filter(r=>r.firstWatch!>=cut);
  const workFolds=Array.from({length:5},(_,i)=>({train:data.history.filter(r=>workFold(r.work.id)!==i),held:known.filter(r=>workFold(r.work.id)===i)}));
  const arms:Arm[]=['full','exposure only','returns','completion','drop','pace','binge','behind','endorsement','with break'];
  const results=[];
  for(const [name,folds,asOf,timeline] of [['work',workFolds,data.asOf,now],['future',[{train:histories,held}],cut,before]] as const){
    const breaks=new Set([...timeline.values()].filter(t=>t.resumed).map(t=>t.root));
    const baseline=new Map<string,Prediction>(),displayBaseline=new Map<string,Prediction>();
    for(const arm of arms){
      const predictions=[];
      const fit:typeof trainTasteMedium=(...args)=>{
        const model=trainer(...args);
        return {...model,add:row=>model.add({...row,work:ablate(row.work,arm,breaks)})};
      };
      for(const fold of folds)predictions.push(await evaluateSplit(data,fold.train,fold.held,rated,asOf,fit,scorer));
      if(arm==='full')for(const row of predictions.flat())baseline.set(row.id,row);
      const r=summarize(predictions);
      const shown=predictions.map(group=>group.map(p=>({...p,rank:p.score??0})));
      const byDisplay=summarize(shown);
      if(arm==='full')for(const row of shown.flat())displayBaseline.set(row.id,row);
      results.push({split:name,arm,scored:r.scored,labels:r.labels,hash:r.heldOutHash,ordering:r.ordering,standalone:r.scoreOnly.percent,top20:r.top20,animation:r.genres.Animation,
        topByDisplay:byDisplay.top20,animationByDisplay:byDisplay.genres.Animation,paired:paired(baseline,predictions),pairedStandalone:paired(displayBaseline,shown)});
    }
  }
  return {cut:new Date(cut).toISOString(),trainingRatings: rated,
    methodology:'Fixed unseen work folds, plus future first recorded watches. The time split uses complete dated watch histories ending before the cutoff and retrospective release/earliest known Jellyfin arrival dates. Undated drops, favourites and inferred series completion are withheld. Paired intervals condition on fitted fold scores and common scored titles. A later first recorded watch does not establish when an imported rating was originally given.',
    rated:known.length,high:known.filter(r=>r.work.rating!>=4).length,datedRatings:known.filter(r=>dates.has(r.work.id)).length,
    afterCutWithVerifiedRatingDate:held.filter(r=>(dates.get(r.work.id)??0)>=r.firstWatch!).length,
    trainingTitlesBeforeCut:histories.length,fullCoverage:coverage(data.history,new Set([...now.values()].filter(r=>r.resumed).map(r=>r.root))),
    temporalCoverage:coverage(histories,new Set([...before.values()].filter(r=>r.resumed).map(r=>r.root))),results};
}

if(import.meta.main){
  const args=Bun.argv.slice(2),rated=args.includes('--ratings');
  const [user,path]=args.filter(arg=>arg!=='--ratings');
  if(!user)throw Error('Supply an authorized copy account.');
  try{
    const frozen=path?JSON.parse(await readFile(path,'utf8')):undefined;
    const data:TasteReplayDataset=frozen?(Array.isArray(frozen)?frozen.find(x=>x.medium==='show'):frozen):await captureTaste(user,'show');
    console.log(JSON.stringify(await replayShowHabits(data,user,scorerFromReference,rated),null,2));
  }finally{await closeDb();}
}
