// Read side of the personal experiment. The serving process never trains a model.
import {createHash} from 'node:crypto';
import {sql as query} from 'drizzle-orm';
import {getDb, getSql} from '#lib/server/db/index.js';
import {trackReadQuery} from '#lib/server/db/read-cancellation.js';
import {requireFeature} from '#lib/server/features.js';
import {AppError} from '#lib/server/security/errors.js';
import {tastePreviewUser} from './taste-preview-access.server';
import {tasteRevisionSql, targetFeatures} from './taste-cache.server';
import {previewPolicyRevision} from './taste-preview-policy';
import {maxTasteBatchSize} from './card-taste';
import {workTasteFeatures} from './work-features.server';
import {scoreTasteV2, tasteV2Version,tasteV2AffinityUses, type TasteV2Medium, type TasteV2Features, type TasteV2Profile, type TasteV2Result} from './taste-v2';

export const previewMedia = ['movie','show'] as const;
export type PreviewTarget = {id:string; root:string; kind:string; medium:TasteV2Medium; known:boolean;epoch:string|null};
export type PreviewMatch = {root:string; medium:TasteV2Medium; known:boolean; pending:boolean; match:TasteV2Result|null};
export const previewRevisionSql=query`${tasteRevisionSql} || ':' || coalesce((select revision::text from content_revisions
      where scope='global' and domain='tracking'),'0') || ':' || ${String(tasteV2Version)+':'+previewPolicyRevision}::text`;
export async function previewContext(userId:string) {
  if (!tastePreviewUser(userId)) throw new AppError(404,'Taste preview unavailable.');
  const config=await requireFeature(userId,'personalisation');
  if (!config.developerMode || config.libraryOnly || !config.features.screen) throw new AppError(404,'Taste preview unavailable.');
  const [row]=await getDb().execute<{revision:string; region:string; prepared:boolean}>(query`
    select ${previewRevisionSql} as revision,
      coalesce(u.settings->>'region','GB') as region,to_regclass('coast_taste_preview.profiles') is not null as prepared
      from users u where u.id=${userId}::uuid and not u.disabled`);
  if (!row) throw new AppError(404,'Taste preview unavailable.');
  return {revision:row.revision,region:row.region,prepared:row.prepared,config};
}

const references=new Map<TasteV2Medium,{key:string; profile:TasteV2Profile}>();
export async function previewReference(userId:string,medium:TasteV2Medium,revision:string) {
  const sql=getSql();
  const previous=references.get(medium);
  const [row]=await trackReadQuery(()=>sql<{epoch:string; model:TasteV2Profile|null; updated:Date}[]>`
    select epoch, case when epoch::text<> ${previous?.key ?? ''} then model end as model,
      published_at as updated from coast_taste_preview.profiles
    where user_id=${userId} and medium=${medium} and revision=${revision}`);
  if (!row) return null;
  const profile=row.model ?? previous?.profile;
  if (!profile) return null;
  references.set(medium,{key:row.epoch,profile});
  return {profile, epoch:row.epoch,updated:row.updated};
}

// Look up only examples already present in this viewer's authorised publication.
export async function exampleTitles(ids:string[]) {
  if (!ids.length) return {};
  const sql=getSql();
  const rows=await trackReadQuery(()=>sql<{id:string;title:string}[]>`select id,title from media where id=any(${sql.array([...new Set(ids)],'UUID')}::uuid[])`);
  return Object.fromEntries(rows.map(row=>[row.id,row.title]));
}

export async function previewProfile(userId:string, medium:TasteV2Medium, dimension:string, page:number) {
  const {revision,prepared}=await previewContext(userId);
  if (!prepared) return null;
  const entry=await previewReference(userId,medium,revision);
  if (!entry) return null;
  const {profile}=entry;
  const order=[...profile.dimensions];
  const strength=(item:TasteV2Profile['affinities'][number])=>Math.abs(item.affinity-50)*item.confidence;
  const values=profile.affinities.filter(item=>item.dimension===dimension).sort((a,b)=>
    strength(b)-strength(a) || b.independent-a.independent || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const items=values.slice((page-1)*25,page*25);
  return {works:profile.works,ratings:profile.ratings,stage:profile.stage,updated:entry.updated,dimensions:order.map(key=>({
    key,count:profile.affinities.filter(item=>item.dimension===key).length})),items,pages:Math.max(1,Math.ceil(values.length/25)),
    uses:Object.fromEntries(items.map(item=>[item.id,tasteV2AffinityUses(profile,item)])),
    examples:await exampleTitles(items.flatMap(item=>[...item.supporting,...item.contradicting]))};
}

export function featureDigest(features:TasteV2Features) {
  return createHash('sha256').update(JSON.stringify(Object.entries(features).sort(([a],[b])=>a.localeCompare(b))
    .map(([key,list])=>[key,[...list].sort((a,b)=>a.id.localeCompare(b.id))]))).digest('hex');
}

export async function previewMatches(userId:string,ids:string[],inspect=false,admittedOnly=false) {
  const {config,region,revision,prepared}=await previewContext(userId);
  if (ids.length>maxTasteBatchSize) throw new AppError(400,'Too many taste matches requested.');
  const sql=getSql(), unique=[...new Set(ids)];
  const result=new Map<string,PreviewMatch>();
  if (!prepared || !unique.length) return result;
  const targets=await trackReadQuery(()=>sql<PreviewTarget[]>`with targets as (
    select w.id,w.kind, coalesce(e.show_id,s.show_id,w.id) as root,
      case when w.kind='movie' then 'movie' else 'show' end as medium
    from works w left join episodes e on e.media_id=w.id left join seasons s on s.media_id=w.id
    where w.id=any(${sql.array(unique,'UUID')}::uuid[]) and w.kind in ('movie','show','episode','season')
   ) select t.*,case when p.revision=${revision} then p.epoch end as epoch,exists(select 1 from coast_taste_preview.known k where k.user_id=${userId} and k.root=t.root) as known
    from targets t left join coast_taste_preview.profiles p on p.user_id=${userId} and p.medium=t.medium
    where ${!admittedOnly} or p.card_admitted`);
  if (!targets.length) return result;
  const features=await workTasteFeatures([...new Set(targets.flatMap(t=>[t.id,t.root]))],config.metadataSource,undefined,region,undefined,true);
  const pending:{id:string;root:string;epoch:string;medium:TasteV2Medium;digest:string;features:TasteV2Features}[]=[];
  const known=targets.filter(t=>t.known);
  const rows=known.length ? await trackReadQuery(()=>sql<{id:string;epoch:string;digest:string;result:TasteV2Result|null}[]>`
    select id,epoch,digest,case when ${inspect} or result is null then result
      else jsonb_build_object('score',result->'score','confidence',result->'confidence','reason',result->'reason','signals','[]'::jsonb) end as result
      from coast_taste_preview.targets where user_id=${userId}
    and id=any(${sql.array(known.map(t=>t.id),'UUID')}::uuid[])`):[];
  const saved=new Map(rows.map(row=>[row.id,row]));
  const inspections:string[]=[];
  for (const medium of new Set(targets.map(t=>t.medium))) {
    const group=targets.filter(t=>t.medium===medium);
    const reference=group.some(t=>!t.known) ? await previewReference(userId,medium,revision) : null;
    for (const t of group) {
      const view:PreviewMatch={root:t.root,medium,known:t.known,pending:!t.epoch || (!t.known && reference?.epoch!==t.epoch),match:null};
      result.set(t.id,view);
      if (view.pending || !t.epoch) continue;
      const item=targetFeatures({...t,precise:t.id!==t.root},features);
      if (!t.known && reference) { view.match=scoreTasteV2(reference.profile,item,{details:inspect}); continue; }
      const digest=featureDigest(item), cached=saved.get(t.id);
      if (cached?.epoch===t.epoch && cached.digest===digest) {
        view.match=cached.result;
        if (inspect && !cached.result) inspections.push(t.id);
      } else {
        pending.push({id:t.id,root:t.root,epoch:t.epoch,medium,digest,features:item});
      }
      view.pending=view.match===null;
    }
  }
  if (inspections.length) await sql`update coast_taste_preview.targets set inspection=true
    where user_id=${userId} and result is null and not inspection and id=any(${sql.array(inspections,'UUID')}::uuid[])`;
  if (pending.length) {
    await sql`insert into coast_taste_preview.targets(user_id,id,root,medium,epoch,digest,features,inspection)
      select ${userId}::uuid,t.id,t.root,t.medium,t.epoch,t.digest,t.features,${inspect} from
      jsonb_to_recordset(${JSON.stringify(pending)}::text::jsonb) t(id uuid,root uuid,medium text,epoch uuid,digest text,features jsonb)
      join coast_taste_preview.profiles p on p.user_id=${userId} and p.medium=t.medium and p.epoch=t.epoch
      on conflict(user_id,id) do update set root=excluded.root,medium=excluded.medium,epoch=excluded.epoch,
        digest=excluded.digest,features=excluded.features,inspection=excluded.inspection,result=null,requested_at=now()
      where (targets.epoch,targets.digest) is distinct from (excluded.epoch,excluded.digest)`;
  }
  return result;
}
