import {sql} from 'drizzle-orm';
import type {Database} from '#lib/server/db/index.js';
import {getSql} from '#lib/server/db/index.js';
import {categoryEnabled} from '#lib/experimental.js';
import type {FeatureConfig} from '#lib/server/features.js';
import {assertJobLease} from '#lib/server/queue/execution.js';
import {visitTasteObservations} from './taste-history.server';
import {tasteMedia,type TasteMedium} from './taste-profile';
import {tasteOpportunityIds} from './taste-selection.server';
import {workTasteFeatures} from './work-features.server';
import {trainPersonalTaste,scorePersonalTaste,preparePersonalCatalogue,type PersonalTasteProfile,type PersonalTasteObservation} from './taste-personal';
import type {TasteV2Catalogue} from './taste-v2';
import {selectedWork,type SelectedDonor,type SelectedWork} from './taste-selected-rules';
import {buildFamilyAliases,familyFold,familyKeys,matchMetadata,packDonor,type MatchEvidence,type MatchMetadata} from './taste-personal-evidence.server';

type Tx=Parameters<Parameters<Database['transaction']>[0]>[0];
type Member={id:string;medium:TasteMedium;fold:number};
type StoredModel={medium:TasteMedium;fold:number;model:PersonalTasteProfile;evidence:MatchEvidence};
type Publication={members:Member[];models:StoredModel[]};

async function catalogueCounts(userId:string, media:TasteMedium[],config:FeatureConfig,region:string){
  const counts=new Map(media.map(m=>[m,preparePersonalCatalogue(m,[])]));
  if(!media.length)return counts;
  const titles=await tasteOpportunityIds(userId,media,config.libraryOnly);
  for(let start=0;start<titles.length;start+=300){
    await assertJobLease(getSql());
    const batch=titles.slice(start,start+300);
    const features=await workTasteFeatures(batch.map(r=>r.id),config.metadataSource,undefined,region,undefined,true);
    for(const [medium,rows] of Map.groupBy(batch,r=>r.medium)){
      const total=counts.get(medium)!;
      const part=preparePersonalCatalogue(medium,rows.map(r=>features.get(r.id)??{}));
      total.size+=part.size;
      for(const [k,v] of Object.entries(part.counts))total.counts[k]=(total.counts[k]??0)+v;
      for(const k of Object.keys(part.known) as (keyof typeof part.known)[])total.known[k]=(total.known[k]??0)+(part.known[k]??0);
    }
  }
  return counts;
}

/** A target family and a donor family must both be hidden from the model that estimates donor errors. */
async function prepareMedium(medium:TasteMedium,history:PersonalTasteObservation[],metadata:Map<string,MatchMetadata>,
  catalogue:TasteV2Catalogue,asOf:number):Promise<Publication>{
  const aliases=buildFamilyAliases(history.map(({work,features})=>({id:work.id,
    keys:familyKeys(work.id,metadata.get(work.id)?.collections??[],features)})));
  const members=history.map(({work})=>({id:work.id,medium,fold:familyFold(aliases[work.id]??work.id)}));
  const foldById=new Map(members.map(m=>[m.id,m.fold]));
  const folds=[...new Set(members.map(m=>m.fold))].sort();
  const direct:{work:SelectedWork;stars:number;features:PersonalTasteObservation['features'];fold:number}[]=[];
  if(medium==='movie'||medium==='show')for(const {work,features} of history){
    const meta=metadata.get(work.id);
    if(meta?.stars==null)continue;
    direct.push({work:selectedWork(work.id,aliases[work.id],medium,features,meta),stars:meta.stars,features,fold:foldById.get(work.id)!});
  }
  const independent=new Map<number,Map<string,number|null>>();
  for(const fold of [-1,...folds])independent.set(fold,new Map());
  async function fit(excluded:number[]){
    // Yield between CPU fits, including on Bun's in-process web/queue deployment.
    await new Promise<void>(resolve=>setImmediate(resolve));
    await assertJobLease(getSql());
    return trainPersonalTaste(medium,excluded.length?history.filter(r=>!excluded.includes(foldById.get(r.work.id)!)):history,{catalogue,asOf});
  }
  const saved:{fold:number;model:PersonalTasteProfile}[]=[];
  saved.push({fold:-1,model:await fit([])});
  for(const fold of folds){
    const model=await fit([fold]);
    saved.push({fold,model});
    for(const item of direct)if(item.fold===fold){
      const score=scorePersonalTaste(model,item.features,{details:false}).score;
      independent.get(-1)!.set(item.work.id,score);
      // One held-out fold covers both families when unrelated titles land in the same fold.
      independent.get(fold)!.set(item.work.id,score);
    }
  }
  if(direct.length)for(const [position,left] of folds.entries()){
    for(const right of folds.slice(position+1)){
      const targets=direct.filter(r=>r.fold===left||r.fold===right);
      if(!targets.length)continue;
      const both=await fit([left,right]);
      for(const r of targets)independent.get(r.fold===left?right:left)!.set(r.work.id,
        scorePersonalTaste(both,r.features,{details:false}).score);
    }
  }
  const donors:SelectedDonor[]=direct.map(item=>{
    const score=independent.get(-1)!.get(item.work.id)??null;
    return {...item.work,stars:item.stars,native:score,publicNative:score};
  });
  const models=saved.map(({fold,model})=>{
    const scores=independent.get(fold)!;
    const evidence:MatchEvidence=fold===-1?{families:aliases,donors:donors.map(packDonor)}:
      {families:{},donors:[],residuals:Object.fromEntries([...scores].filter((entry):entry is [string,number]=>entry[1]!==null))};
    return {medium,fold,model,evidence};
  });
  return {members,models};
}

export async function buildPersonalMatches(userId:string,config:FeatureConfig,region:string):Promise<Publication>{
  const media=tasteMedia.filter(m=>categoryEnabled(config,m.category));
  const history=new Map<TasteMedium,PersonalTasteObservation[]>(media.map(m=>[m.value,[]]));
  await visitTasteObservations(userId,[...new Set(media.map(m=>m.category))],config.metadataSource,region,
    ({work,features,credits})=>{history.get(work.medium)?.push({work,features,credits});},true,true);
  const nonempty=media.filter(m=>history.get(m.value)!.length).map(m=>m.value);
  const counts=await catalogueCounts(userId,nonempty,config,region);
  const result:Publication={members:[],models:[]};
  const asOf=Date.now();
  for(const {value:medium} of media){
    const observations=history.get(medium)!;
    const metadata=new Map<string,MatchMetadata>();
    for(let start=0;start<observations.length;start+=300){
      const batch=await matchMetadata(observations.slice(start,start+300).map(r=>r.work.id),userId);
      for(const [i,m] of batch)metadata.set(i,m);
    }
    const pub=await prepareMedium(medium,observations,metadata,counts.get(medium)??preparePersonalCatalogue(medium,[]),asOf);
    result.members.push(...pub.members);
    result.models.push(...pub.models);
    history.delete(medium);
  }
  return result;
}

export async function savePersonalMatches(tx:Tx,userId:string,revision:string,publication:Publication){
  await tx.execute(sql`delete from user_taste_match_members where user_id=${userId}::uuid`);
  await tx.execute(sql`delete from user_taste_match_models where user_id=${userId}::uuid`);
  // Serialize one model at a time; a large account can have many materialised folds.
  for(const {medium,fold,model,evidence} of publication.models)
    await tx.execute(sql`insert into user_taste_match_models(user_id,medium,fold,revision,model,evidence)
      values(${userId}::uuid,${medium},${fold},${revision},${JSON.stringify(model)}::text::jsonb,${JSON.stringify(evidence)}::text::jsonb)`);
  for(let start=0;start<publication.members.length;start+=500){
    const rows=publication.members.slice(start,start+500);
    await tx.execute(sql`insert into user_taste_match_members(user_id,medium,root,fold)
      select ${userId}::uuid,member.medium,member.id,member.fold from jsonb_to_recordset(${JSON.stringify(rows)}::text::jsonb)
      as member(id uuid,medium text,fold smallint)`);
  }
}
