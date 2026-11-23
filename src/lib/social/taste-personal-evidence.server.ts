import {createHash} from 'node:crypto';
import {getSql} from '#lib/server/db/index.js';
import {trackReadQuery} from '#lib/server/db/read-cancellation.js';
import type {TasteV2Features} from './taste-v2';
import type {SelectedDonor} from './taste-selected-rules';
import {resolvedTasteSynopsis,tasteSynopsisModel} from './taste-synopsis.server';

export type MatchMetadata = {
  id:string; collections:string[]; stars:number|null;
  credits:{id:string;role:string}[]; studios:{id:string}[]; networks:{id:string}[];
  audience:{score:number;scale:number;votes:number}|null;
  synopsis?:number[];
};

/** Read provider-verified IDs and votes. Catalogue features can contain human-readable company names. */
export async function matchMetadata(ids:string[], owner?:string){
  const sql=getSql();
  if(!ids.length)return new Map<string,MatchMetadata>();
  const rows=await trackReadQuery(()=>sql<MatchMetadata[]>`
    select w.id,coalesce(rel.ids,'{}'::text[]) as collections,
      coalesce(snap.facts->'credits','[]'::jsonb) as credits,
      coalesce(snap.facts->'studios','[]'::jsonb) as studios,
      coalesce(snap.facts->'networks','[]'::jsonb) as networks,snap.facts->'audience' as audience,
      case when embedding.work_id is not null then
       case when embedding.synopsis_sha256=encode(sha256(convert_to(${resolvedTasteSynopsis(sql)},'UTF8')),'hex')
       then embedding.embedding end end as synopsis,
      ${owner?sql`rating.value::float8`:sql`null::float8`} as stars
    from works w left join work_taste_synopses embedding on embedding.work_id=w.id and embedding.model=${tasteSynopsisModel}
      and cardinality(embedding.embedding)=384 and w.kind in ('movie','show')
    left join media m on m.id=embedding.work_id left join metadata_overrides art on art.media_id=embedding.work_id
    left join lateral (
      select array_agg(distinct r.parent_id::text) as ids from media_relationships r
      where r.child_id=w.id and r.kind in ('collection','franchise')
    ) rel on true
    left join lateral (
      select s.raw->'facts' as facts,s.overview from metadata_snapshots s
      where s.media_id=w.id and s.provider='tmdb'
      order by (s.language='en') desc,s.updated_at desc,s.id limit 1
    ) snap on w.kind in ('movie','show')
    ${owner?sql`left join ratings rating on rating.media_id=w.id and rating.user_id=${owner}::uuid`:sql``}
    where w.id=any(${sql.array(ids,'UUID')}::uuid[])`);
  return new Map(rows.map(row=>{
    if(row.synopsis&&!unitSynopsis(row.synopsis))delete row.synopsis;
    return [row.id,row];
  }));
}
function unitSynopsis(vector:readonly number[]){
  const norm=vector.reduce((sum,v)=>sum+v*v,0);
  return Number.isFinite(norm)&&Math.abs(norm-1)<=.005;
}

export type FamilyAliases=Record<string,string>;
type PublishedDonor=Omit<SelectedDonor,'synopsis'>&{synopsis?:string};
export type MatchEvidence={families:FamilyAliases; donors:PublishedDonor[]; residuals?:Record<string,number>};

/** JSONB stores every vector coordinate as a decimal. Pack the exact JS doubles once per publication. */
export function packDonor({synopsis,...donor}:SelectedDonor):PublishedDonor{
  if(!synopsis)return donor;
  const bytes=Buffer.allocUnsafe(synopsis.length*8);
  for(let i=0;i<synopsis.length;i++)bytes.writeDoubleLE(synopsis[i],i*8);
  return {...donor,synopsis:bytes.toString('base64')};
}
export function readDonor({synopsis,...donor}:PublishedDonor):SelectedDonor{
  if(!synopsis)return donor;
  const bytes=Buffer.from(synopsis,'base64');
  if(bytes.length!==384*8)return donor;
  return {...donor,synopsis:Array.from({length:384},(_,i)=>bytes.readDoubleLE(i*8))};
}
export function familyKeys(id:string, collections:readonly string[], features:TasteV2Features){
  return [id,...collections.map(c=>'collection:'+c),...(features.franchises??[]).map(f=>'feature:'+f.id)];
}

export function buildFamilyAliases(items:readonly {id:string;keys:string[]}[]):FamilyAliases{
  const parent=new Map<string,string>();
  function root(id:string){
    let top=id;
    while(parent.has(top))top=parent.get(top)!;
    while(id!==top){const next=parent.get(id)!;parent.set(id,top);id=next;}
    return top;
  }
  for(const {id,keys} of items)for(const key of keys){
    const a=root(id),b=root(key);
    if(a!==b)parent.set(a>b?a:b,a>b?b:a);
  }
  // A key that already is the representative must still resolve for unseen siblings.
  const result:FamilyAliases=Object.create(null);
  for(const {keys} of items)for(const key of keys)result[key]=root(key);
  return result;
}
export function familyFold(id:string){return createHash('sha256').update(id).digest()[0]%5;}
