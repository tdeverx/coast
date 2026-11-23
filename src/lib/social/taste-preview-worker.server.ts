import type {MetadataPolicy} from '#lib/catalogue/metadata/resolve.js';
import {getSql} from '#lib/server/db/index.js';
import {tasteOpportunityIds} from './taste-selection.server';
import {workTasteFeatures} from './work-features.server';
import {visitTasteObservations} from './taste-history.server';
import {previewContext,previewMedia} from './taste-preview.server';
import {trainTasteV2,scoreTasteV2,prepareTasteV2Catalogue,type TasteV2Catalogue,type TasteV2Observation,type TasteV2Medium,type TasteV2Features} from './taste-v2';

import {previewCardAdmitted,previewModelOptions} from './taste-preview-policy';

export async function prepareTastePreview(userId:string) {
  await previewContext(userId);
  const sql=getSql();
  await sql.begin(async tx=>{
    await tx`create schema if not exists coast_taste_preview`;
    await tx`create table if not exists coast_taste_preview.profiles(
      user_id uuid not null references users(id) on delete cascade, medium text not null,
      revision text not null, epoch uuid not null, model jsonb not null, observations jsonb not null,catalogue jsonb not null, card_admitted boolean not null,
      published_at timestamptz not null default now(), primary key(user_id,medium))`;
    await tx`create table if not exists coast_taste_preview.known(user_id uuid not null references users(id) on delete cascade,
      root uuid not null, primary key(user_id,root))`;
    await tx`create table if not exists coast_taste_preview.targets(user_id uuid not null references users(id) on delete cascade,
      id uuid not null, root uuid not null,medium text not null,epoch uuid not null,digest text not null,
      features jsonb not null,result jsonb,inspection boolean not null default false,requested_at timestamptz not null default now(), primary key(user_id,id))`;
    await tx`create index if not exists taste_preview_pending on coast_taste_preview.targets(user_id,requested_at) where result is null`;
  });
}

/** Catalogue membership is independent of a target's personal rating, watch, and absence. */
export async function previewCatalogue(userId:string,policy:MetadataPolicy,region:string) {
  const opportunities=await tasteOpportunityIds(userId,previewMedia,false);
  const catalogue={movie:prepareTasteV2Catalogue([]),show:prepareTasteV2Catalogue([])};
  for (let offset=0;offset<opportunities.length;offset+=300) {
    const batch=opportunities.slice(offset,offset+300);
    const features=await workTasteFeatures(batch.map(row=>row.id),policy,undefined,region,undefined,true);
    for(const medium of previewMedia) {
      const partial=prepareTasteV2Catalogue(batch.filter(row=>row.medium===medium).map(row=>features.get(row.id)??{}));
      const total=catalogue[medium];
      total.size+=partial.size;
      for(const [key,count] of Object.entries(partial.counts)) total.counts[key]=(total.counts[key]??0)+count;
      for(const key of Object.keys(partial.known) as (keyof typeof partial.known)[]) total.known[key]=(total.known[key]??0)+(partial.known[key]??0);
    }
  }
  return catalogue;
}

async function publish(userId:string, force:boolean) {
  const sql=getSql();
  const {config,revision,region}=await previewContext(userId);
  const [status]=await sql`select count(*)::int as fresh from coast_taste_preview.profiles where
    user_id=${userId} and revision=${revision} and published_at>now()-interval '7 days'`;
  if (!force && status.fresh===previewMedia.length) return false;
  const rows:Record<TasteV2Medium,TasteV2Observation[]>={movie:[],show:[]};
  await visitTasteObservations(userId,['screen'],config.metadataSource,region,({work,features,credits})=>{
    if (work.medium==='movie'||work.medium==='show') rows[work.medium].push({work,features,credits});
  },true,true);
  const catalogue=await previewCatalogue(userId,config.metadataSource,region);
  const models=previewMedia.map(medium=>trainTasteV2(medium,rows[medium],{...previewModelOptions[medium],catalogue:catalogue[medium]}));
  if ((await previewContext(userId)).revision!==revision) return false;
  await sql.begin(async tx=>{
    const epoch=crypto.randomUUID();
    for(const model of models) {
      await tx`insert into coast_taste_preview.profiles(user_id,medium,revision,epoch,model,observations,catalogue,card_admitted)
        values (${userId},${model.medium},${revision},${epoch},${JSON.stringify(model)}::text::jsonb,${JSON.stringify(rows[model.medium])}::text::jsonb,${JSON.stringify(catalogue[model.medium])}::text::jsonb,${previewCardAdmitted(model.medium,model.ratings)})
        on conflict(user_id,medium) do update set revision=excluded.revision,epoch=excluded.epoch,model=excluded.model,
          observations=excluded.observations,catalogue=excluded.catalogue,card_admitted=excluded.card_admitted,published_at=now()`;
    }
    await tx`delete from coast_taste_preview.known where user_id=${userId}`;
    const roots=[...rows.movie,...rows.show].map(row=>row.work.id);
    await tx`insert into coast_taste_preview.known(user_id,root)
      select ${userId}::uuid,unnest(${tx.array(roots,'UUID')}::uuid[])`;
    await tx`delete from coast_taste_preview.targets where user_id=${userId}`;
  });
  return true;
}

type Pending={id:string;root:string;medium:TasteV2Medium;features:TasteV2Features;digest:string;epoch:string};
async function completeKnown(userId:string) {
  const sql=getSql();
  const pending=await sql<Pending[]>`select t.id,t.root,t.medium,t.features,t.digest,t.epoch
    from coast_taste_preview.targets t join coast_taste_preview.profiles p using(user_id,medium,epoch)
    where t.user_id=${userId} and t.result is null order by t.inspection desc,t.requested_at,t.id limit 8`;
  if (!pending.length) return 0;
  for(const medium of new Set(pending.map(row=>row.medium))) {
    const targets=pending.filter(row=>row.medium===medium);
    const [source]=await sql<{observations:TasteV2Observation[];catalogue:TasteV2Catalogue}[]>`select observations,catalogue from coast_taste_preview.profiles
      where user_id=${userId} and medium=${medium} and epoch=${targets[0].epoch}`;
    if (!source) continue;
    for(const root of new Set(targets.map(row=>row.root))) {
      const profile=trainTasteV2(medium,source.observations,{...previewModelOptions[medium],excludeRoot:root,catalogue:source.catalogue,contextEvidence:false});
      for(const target of targets.filter(row=>row.root===root)) {
        const match=scoreTasteV2(profile,target.features);
        await sql`update coast_taste_preview.targets set result=${JSON.stringify(match)}::text::jsonb
          where user_id=${userId} and id=${target.id} and epoch=${target.epoch} and digest=${target.digest}`;
      }
    }
  }
  await sql`delete from coast_taste_preview.targets t using (
    select id from coast_taste_preview.targets where user_id=${userId} and result is not null
    order by requested_at desc,id offset 512) old where t.user_id=${userId} and t.id=old.id`;
  return pending.length;
}

export async function runTastePreviewWorker(userId:string, force=false, checkPublication=true) {
  if (!checkPublication && !force) {
    const [queue]=await getSql()`select exists(select 1 from coast_taste_preview.targets
      where user_id=${userId} and result is null) as ready`;
    if (!queue.ready) return {published:false,completed:0};
  }
  await previewContext(userId);
  const lease=await getSql().reserve();
  let locked=false;
  try {
    const [row]=await lease`select pg_try_advisory_lock(hashtextextended(${'coast:taste-preview:'+userId},0)) as locked`;
    locked=row.locked;
    if (!locked) return {published:false,completed:0};
    return {published:(checkPublication || force) && await publish(userId,force),completed:await completeKnown(userId)};
  } finally {
    try { if (locked) await lease`select pg_advisory_unlock(hashtextextended(${'coast:taste-preview:'+userId},0))`; }
    finally { lease.release(); }
  }
}
