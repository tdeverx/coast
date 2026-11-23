// bun scripts/taste-replay.ts <username> [movie|show|game|music|book|comic]
// Use a database copy or a read-only connection. Console output contains aggregate metrics only.
import {createHash} from 'node:crypto';
import {getSql,closeDb} from '../src/lib/server/db';
import {getFeatureConfig} from '../src/lib/server/features';
import {categoryEnabled} from '../src/lib/experimental';
import {visitTasteObservations} from '../src/lib/social/taste-history.server';
import {workTasteFeatures} from '../src/lib/social/work-features.server';
import {opportunityPoolWeights,tasteOpportunityIds,type TasteOpportunity} from '../src/lib/social/taste-selection.server';
import {tasteMedia,scorerFromReference,type TasteMedium,type TasteFeatures} from '../src/lib/social/taste-profile';
import {hasAudienceEvidence,type TasteAudienceRating} from '../src/lib/social/taste-rating-model';
import {trainTasteMedium,type TasteObservation} from '../src/lib/social/taste-training';

type Observation=TasteObservation & {firstWatch?:number;release?:number;ratingRecorded?:number;popularity?:number;collections?:string[]};
type Opportunity=TasteOpportunity & {features:TasteFeatures;release?:number;sampleOrder:number};
type ReplayMetadata={id:string;ordinal:number;released:Date|string|null;collections:string[]|null;audience:TasteAudienceRating|null};
type DatedExperience={id:string;first:Date|string};
export type TasteReplayDataset={medium:TasteMedium;asOf:number;history:Observation[];catalogue:Opportunity[];chosenPools:Record<string,boolean>};
type Dataset=TasteReplayDataset;

export async function captureTaste(username:string, medium:TasteMedium):Promise<Dataset> {
  const sql=getSql();
  const [account]=await sql`select id,coalesce(settings->>'region','GB') as region from users where username=${username} and not disabled`;
  if(!account)throw new Error('Account unavailable.');
  const {id,region}=account, config=await getFeatureConfig(id,sql);
  const category=tasteMedia.find(m=>m.value===medium)!.category;
  if(!config.features.personalisation||!categoryEnabled(config,category))throw new Error('Taste unavailable for this account or medium.');
  const history:Observation[]=[];
  await visitTasteObservations(id,[category],config.metadataSource,region,row=>{if(row.work.medium===medium)history.push(row);},true);
  const known=new Map(history.map(row=>[row.work.id,row.work.chosen]));
  // Capture every eligible known work plus the bounded hash sample of unfamiliar ones.
  // Each fold can then restore withheld works to the opportunity pool without using their outcomes.
  const rows=await tasteOpportunityIds(id,[medium],config.libraryOnly===true,new Map([...known.keys()].map(key=>[key,true])),true);
  const chosenPools=Object.fromEntries(rows.filter(row=>row.observed).map(row=>[row.id,row.available]));
  const ids=[...new Set([...known.keys(),...rows.map(r=>r.id)])];
  const metadata=await sql<ReplayMetadata[]>`select w.id,row_number() over(order by hashtextextended(w.id::text,19),w.id)::int as ordinal,
    coalesce(m.release_date,g.release_date,a.release_date,b.release_date,make_date(coalesce(a.year,b.published_year),12,31)) as released,
    (select array_agg(r.parent_id::text order by r.parent_id) from media_relationships r
     where r.child_id=w.id and r.kind in ('collection','franchise')) as collections,
    coalesce((select ms.raw#>'{facts,audience}' from metadata_snapshots ms where ms.media_id=m.id
      and ms.provider='tmdb' and ms.raw#>'{facts,audience}' is not null order by ms.updated_at desc,ms.id limit 1),
      g.catalogue_facts->'audience') as audience
    from works w left join media m using(id) left join games g using(id) left join reading_works b using(id)
    left join music_works a using(id) where w.id=any(${sql.array(ids,'UUID')}::uuid[])`;
  const byId=new Map(metadata.map(row=>[row.id,row]));
  const catalogue:Opportunity[]=[];
  for(let i=0;i<rows.length;i+=300){
    const batch=rows.slice(i,i+300),features=await workTasteFeatures(batch.map(r=>r.id),config.metadataSource,undefined,region);
    for(const row of batch){
      const meta=byId.get(row.id)!;
      catalogue.push({...row,features:features.get(row.id)??{},release:meta.released?+new Date(meta.released):undefined,sampleOrder:meta.ordinal});
    }
  }
  // Time-aware replay requires a reliable first experience, not the last import or a saved position.
  const chronology=category==='screen'?await sql<DatedExperience[]>`select coalesce(e.show_id,s.show_id,t.media_id) as id,min(t.occurred_at) as first
    from tracking_events t left join episodes e on e.media_id=t.media_id left join seasons s on s.media_id=t.media_id
    where t.user_id=${id} and t.applied and t.action='watch' and t.value is distinct from false and t.occurred_at_known group by 1`
    :category==='music'?await sql<DatedExperience[]>`select coalesce(a.parent_id,l.track_id) as id,min(l.occurred_at) as first from music_listens l
      left join lateral(select r.parent_id from media_relationships r join works w on w.id=r.parent_id and w.kind='album'
        where r.child_id=l.track_id and r.kind='contains' order by r.position,r.parent_id limit 1) a on true
      where l.user_id=${id} and l.occurred_at_known group by 1`
    :category==='game'?await sql<DatedExperience[]>`select p.game_id as id,min(s.played_at) as first from game_playthroughs p
      join game_sessions s on s.playthrough_id=p.id where p.user_id=${id} group by 1`
    :await sql<DatedExperience[]>`select work_id as id,min(occurred_at) as first from reading_history where user_id=${id}
      and (page>0 or state='completed') group by work_id`;
  const dates=new Map(chronology.map(row=>[row.id,+new Date(row.first)]));
  for(const row of history){
    const meta=byId.get(row.work.id);
    row.firstWatch=dates.get(row.work.id);
    if(row.work.lastRatedAt)row.ratingRecorded=+new Date(row.work.lastRatedAt);
    if(meta?.released)row.release=+new Date(meta.released);
    if(meta?.collections?.length)row.collections=meta.collections;
    const audience=meta?.audience;
    if(hasAudienceEvidence(audience))row.popularity=audience.votes;
  }
  return {medium,asOf:Date.now(),history,catalogue,chosenPools};
}

const hash=(key:string)=>createHash('sha256').update(key).digest();
export const workFold=(id:string)=>hash(id)[0]%5;
export type Prediction={id:string;actual:number;score:number|null;confidence:number;rank:number;release?:number;popularity?:number;genres:string[]};
type Fit=typeof trainTasteMedium;
export async function trainReplayReference(data:Dataset,train:Observation[],rated:boolean,asOf=data.asOf,fit:Fit=trainTasteMedium){
  const count=rated?train.filter(row=>row.work.rating!==null).length:0;
  const model=fit(data.medium,count,null,asOf);
  const chosen=[0,0];
  const trainingIds=new Set(train.map(row=>row.work.id));
  const durationRanks=new Map<number,number>();
  if(data.medium==='game'){
    const ordered=train.flatMap(row=>row.work.playtimeRank==null?[]:[row.work.playtimeRank]).sort((a,b)=>a-b);
    for(let i=0;i<ordered.length;){
      let end=i+1;
      while(end<ordered.length&&ordered[end]===ordered[i])end++;
      durationRanks.set(ordered[i],(i+end-ordered.length)/(ordered.length+4));
      i=end;
    }
  }
  for(const row of train){
    const work=row.work.playtimeRank==null?row.work:{...row.work,playtimeRank:durationRanks.get(row.work.playtimeRank)};
    model.add(rated?{...row,work}:{...row,work:{...work,rating:null},credits:undefined});
    const pool=data.chosenPools[row.work.id];
    if(row.work.chosen&&pool!==undefined)chosen[Number(pool)]++;
  }
  if(model.selection.ready()){
    const eligible=data.catalogue.filter(row=>!trainingIds.has(row.id)&&(asOf===data.asOf||row.release!==undefined&&row.release<=asOf));
    const titles=[];
    for(const pool of [false,true]){
      const source=eligible.filter(row=>row.available===pool).sort((a,b)=>a.sampleOrder-b.sampleOrder);
      if(!source.length)continue;
      const cap=data.medium==='movie'||data.medium==='show'?3000:1500;
      const base=data.catalogue.filter(row=>row.available===pool&&!row.observed);
      const sampledFraction=asOf===data.asOf?1:base.filter(row=>row.release!==undefined&&row.release<=asOf).length/Math.max(1,base.length);
      const size=(base[0]?.poolSize??0)*sampledFraction+source.filter(row=>row.observed).length;
      for(const row of source.slice(0,cap))titles.push({...row,poolSize:size,chosen:chosen[Number(pool)]});
    }
    const weights=opportunityPoolWeights(titles).get(data.medium);
    for(const row of titles)model.selection.addCatalogue(row.features,weights!.get(row.available)!);
  }
  return (await model.finish()).reference;
}

export async function evaluateSplit(data:Dataset,train:Observation[],held:Observation[],rated:boolean,asOf:number,fit:Fit,scorer:typeof scorerFromReference){
  const score=scorer(await trainReplayReference(data,train,rated,asOf,fit));
  const candidates=new Map(data.catalogue.filter(r=>r.observed).map(r=>[r.id,r.features]));
  return held.map(({work,features,release,popularity}):Prediction=>{
    const m=score(candidates.get(work.id)??features);
    return {id:work.id,actual:work.rating!,score:m.score,confidence:m.confidence,rank:((m.score??50)-50)*m.confidence/100+(m.returnTieBreak??0)*1e-6,release,popularity,genres:(features.genres??[]).map(g=>g.name)};
  });
}

function pairs(groups:Prediction[][],measure:(p:Prediction)=>number|undefined){
  let ordered=0,total=0,ties=0;
  let variance=0,canEstimate=true;
  for(const rows of groups){
    const scores=(rows:Prediction[])=>rows.flatMap(row=>{const value=measure(row);return value===undefined?[]:[value];});
    const positives=scores(rows.filter(r=>r.actual>=4)),negatives=scores(rows.filter(r=>r.actual<=3));
    if(!positives.length||!negatives.length)continue;
    const pw=new Float64Array(positives.length),nw=new Float64Array(negatives.length);
    for(const [i,a] of positives.entries())for(const [j,b] of negatives.entries()){
      const credit=Number(a>b)+Number(a===b)/2;
      pw[i]+=credit/negatives.length;nw[j]+=credit/positives.length;
      ordered+=credit;ties+=Number(a===b);total++;
    }
    // DeLong placement variance keeps all comparisons involving the same title together.
    const mean=pw.reduce((sum,x)=>sum+x,0)/pw.length;
    const component=(p:Float64Array)=>p.reduce((sum,x)=>sum+(x-mean)**2,0)/(p.length*(p.length-1));
    if(pw.length<2||nw.length<2)canEstimate=false;
    else variance+=(positives.length*negatives.length)**2*(component(pw)+component(nw));
  }
  const lower=ordered-1.96*Math.sqrt(variance),upper=ordered+1.96*Math.sqrt(variance);
  return {percent:total?Math.round(10000*ordered/total)/100:null,pairs:total,ties,
    conditionalInterval95:total&&canEstimate?[100*Math.max(0,lower/total),100*Math.min(1,upper/total)]:null};
}
export function summarize(groups:Prediction[][]){
  const all=groups.flat(),scored=all.filter(r=>r.score!==null);
  const best=(rows:Prediction[])=>{const top=[...rows].sort((a,b)=>b.rank-a.rank||a.id.localeCompare(b.id)).slice(0,20);
    return {liked:top.filter(r=>r.actual>=4).length,titles:top.length};};
  const genres=Object.fromEntries(['Animation','Science Fiction','Sci-Fi & Fantasy'].map(name=>[name,best(scored.filter(r=>r.genres.includes(name)))]));
  function bandsOf(field:'score'|'confidence'){
    return Array.from({length:5},(_,i)=>{
      const rows=scored.filter(r=>Math.min(4,Math.floor(r[field]!/20))===i);
      const liked=rows.filter(r=>r.actual>=4).length;
      return {from:i*20,to:i===4?100:i*20+19,count:rows.length,liked,likeRate:rows.length?100*liked/rows.length:null,
        meanMatch:rows.length?rows.reduce((n,r)=>n+r.score!,0)/rows.length:null};
    });
  }
  return {labels:all.length,scored:scored.length,abstained:all.length-scored.length,heldOutHash:hash(all.map(p=>p.id).sort().join('\n')).toString('hex'),
    ordering:pairs(groups,r=>r.score===null?undefined:r.rank),scoreOnly:pairs(groups,r=>r.score??undefined),
    releaseOrdering:pairs(groups,r=>r.score===null?undefined:r.release),tasteOnReleaseCoverage:pairs(groups,r=>r.release===undefined||r.score===null?undefined:r.rank),
    popularityOrdering:pairs(groups,r=>r.score===null?undefined:r.popularity),
    tasteOnPopularityCoverage:pairs(groups,r=>r.popularity===undefined||r.score===null?undefined:r.rank),top20:best(scored),genres,
    bands:bandsOf('score'),confidenceBands:bandsOf('confidence')};
}

/** A multi-franchise work links its series into the same held-out component. */
function franchiseFolds(rows:Observation[]){
  const parents=new Map<string,string>();
  function root(key:string){
    let top=key;
    while(parents.has(top))top=parents.get(top)!;
    while(key!==top){const next=parents.get(key)!;parents.set(key,top);key=next;}
    return top;
  }
  for(const row of rows){
    const labels=[...(row.collections??[]).map(key=>'collection:'+key),...(row.features.franchises??[]).map(term=>'feature:'+term.id)];
    for(const label of labels){
      const a=root(row.work.id),b=root(label);
      if(a!==b)parents.set(a<b?b:a,a<b?a:b);
    }
  }
  return new Map(rows.map(row=>[row.work.id,hash(root(row.work.id))[0]%5]));
}

function historicalTraining(data:Dataset,cut:number){
  const result:Observation[]=[];
  for(const row of data.history){
    if(row.firstWatch!==undefined&&row.firstWatch>=cut)continue;
    const finished=!!row.firstWatch&&row.firstWatch<cut&&!!row.work.lastExperiencedAt&&+new Date(row.work.lastExperiencedAt)<cut;
    const knownRating=row.work.rating!==null&&row.ratingRecorded!==undefined&&row.ratingRecorded<cut;
    if(!knownRating&&!finished)continue;
    // The snapshot cannot date every drop, favourite, reset, credit, or later backlog.
    // Restrict the timeline to opinions recorded by the cutoff and verified earlier activity.
    // Today's audience totals and child opinions have no snapshot at this cutoff.
    result.push({...row,credits:undefined,audience:undefined,work:{...row.work,rating:knownRating?row.work.rating:null,
      explicit:0,dropped:false,deliberateReturn:false,repeated:false,implicit:finished?3:0,consumed:finished,chosen:finished&&row.work.chosen,
      lastExperiencedAt:finished?row.work.lastExperiencedAt:null,completion:null,playtimeRank:null,watchHabits:undefined}});
  }
  return result;
}
export async function replayTaste(data:Dataset,fit=trainTasteMedium,scorer=scorerFromReference){
  const results=[];
  const known=data.history.filter(r=>r.work.rating!==null);
  const reliableDates=known.filter(r=>r.firstWatch&&r.work.lastExperiencedAt);
  const cut=reliableDates.map(r=>r.firstWatch!).sort((a,b)=>a-b)[Math.floor(.75*reliableDates.length)];
  const franchise=franchiseFolds(data.history);
  for(const rated of [true,false])for(const split of ['work','franchise','chronological'] as const){
    const groups:Prediction[][]=[];
    if(split==='chronological'){
      if(!cut)continue;
      const train=historicalTraining(data,cut);
      const held=reliableDates.filter(r=>r.firstWatch!>=cut);
      groups.push(await evaluateSplit(data,train,held,rated,cut,fit,scorer));
    }else{
      const foldOf=(row:Observation)=>split==='work'?workFold(row.work.id):franchise.get(row.work.id)!;
      for(let fold=0;fold<5;fold++)groups.push(await evaluateSplit(data,data.history.filter(r=>foldOf(r)!==fold),
        known.filter(r=>foldOf(r)===fold),rated,data.asOf,fit,scorer));
    }
    results.push({rated,split,...summarize(groups)});
  }
  return {medium:data.medium,works:data.history.length,catalogue:data.catalogue.filter(row=>!row.observed).length,
    methodology:{likeThreshold:4,negativeThreshold:3,chronologicalCutoff:cut?new Date(cut).toISOString():null,
      chronologicalTrainingRatings:cut?historicalTraining(data,cut).filter(r=>r.work.rating!==null).length:0,
      scope:'Current catalogue metadata and availability. Chronological training retains dated opinions and earlier verified activity. Per-title habits exclude cross-title normalization during held-out evaluation. Popularity uses TMDB/IGDB audience vote counts with at least 20 votes. Ordering intervals condition on fitted fold scores and describe held-out titles from this account.'},results};
}

if(import.meta.main){
  const [name,kind='movie']=Bun.argv.slice(2);
  const medium=tasteMedia.find(m=>m.value===kind);
  if(!name||!medium)throw new Error('Usage: bun scripts/taste-replay.ts <username> [medium]');
  try{console.log(JSON.stringify(await replayTaste(await captureTaste(name,medium.value)),null,2));}finally{await closeDb();}
}
