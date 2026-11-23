import {sql} from 'drizzle-orm';
import {getDb,getSql} from '#lib/server/db/index.js';
import {trackReadQuery} from '#lib/server/db/read-cancellation.js';
import {AppError} from '#lib/server/security/errors.js';
import {requireFeature,type FeatureConfig} from '#lib/server/features.js';
import {maxTasteBatchSize} from './card-taste';
import {personalMatchVersion,tasteRevisionSql,targetFeatures} from './taste-cache.server';
import {tasteRootJoin} from './taste-root.server';
import {workTasteFeatures} from './work-features.server';
import {familyKeys,familyFold,matchMetadata,readDonor,type MatchEvidence} from './taste-personal-evidence.server';
import {scorePersonalTaste,type PersonalTasteProfile} from './taste-personal';
import type {TasteMedium} from './taste-profile';
import {selectedLowerScore} from './taste-v2';
import {buildSelectedReference,scoreSelected,selectedWork} from './taste-selected-rules';
import type {SelectedRule} from './taste-selected';
import type {TasteV2Result} from './taste-v2';

type Stored={stamp:string;model:PersonalTasteProfile;families:MatchEvidence['families'];reference:ReturnType<typeof buildSelectedReference>|null;
  residuals?:ReadonlyMap<string,number>;storedBytes:number};
type Key={medium:TasteMedium;fold:number};
type StoredRow=Key&{stamp:string;model:PersonalTasteProfile|null;evidence:MatchEvidence|null;storedBytes:number};
type Target={id:string;kind:string;root:string;medium:TasteMedium;fold:number|null;region:string;stamp:string|null};
export type PersonalItemMatch={root:string;withheld:boolean;pending:boolean;score:number|null;confidence:number;
  native:number|null;rule:SelectedRule|null;reason:string;signals:TasteV2Result['signals'];base?:number};

// Each hit still verifies the owner's account, policy, model version and publication timestamp in SQL.
const cache=new Map<string,Stored>();
const maxCacheBytes=12*1024*1024;
let cacheBytes=0;
function remember(key:string,entry:Stored){
  const old=cache.get(key);
  if(old){cacheBytes-=old.storedBytes;cache.delete(key);}
  if(entry.storedBytes>maxCacheBytes)return;
  cacheBytes+=entry.storedBytes;
  cache.set(key,entry);
  while(cache.size>12||cacheBytes>maxCacheBytes){
    const [first,value]=cache.entries().next().value!;
    cache.delete(first);
    cacheBytes-=value.storedBytes;
  }
}
const cacheKey=(owner:string,k:Key)=>[owner,k.medium,k.fold].join('/');
const referenceKey=(k:Key)=>k.medium+'/'+k.fold;
async function references(owner:string,keys:Key[]){
  const unique=new Map(keys.flatMap(k=>[k,{medium:k.medium,fold:-1}]).map(k=>[referenceKey(k),k]));
  const result=new Map<string,Stored>();
  if(!unique.size)return result;
  const held=new Map<string,Stored>();
  const requested=[...unique.values()].map(k=>{
    const key=cacheKey(owner,k),entry=cache.get(key);
    if(entry)held.set(key,entry);
    return {...k,stamp:entry?.stamp??''};
  });
  const rows=await getDb().execute<StoredRow>(sql`
    select m.medium,m.fold,m.published_at::text as stamp,
      pg_column_size(m.model)+pg_column_size(m.evidence) as "storedBytes",
      case when k.stamp<>m.published_at::text then m.model end as model,
      case when k.stamp<>m.published_at::text then m.evidence end as evidence
    from jsonb_to_recordset(${JSON.stringify(requested)}::text::jsonb) k(medium text,fold smallint,stamp text)
    join user_taste_match_models m using(medium,fold) join users u on u.id=m.user_id
    where u.id=${owner}::uuid and not u.disabled and coast_feature_enabled(u.id,'personalisation')
    and coast_category_enabled(u.id,case when m.medium in ('movie','show') then 'screen' else m.medium end)
    and split_part(m.revision,':',1)=split_part(${tasteRevisionSql},':',1)
    and right(m.revision,length(${personalMatchVersion}::text)+1)=':'||${personalMatchVersion}::text
    order by m.fold`) as StoredRow[];
  for(const row of rows){
    const key=cacheKey(owner,row);
    // Use the cache state captured at issue time; concurrent requests may evict or replace its entry.
    const prior=held.get(key);
    let entry=prior?.stamp===row.stamp?prior:null;
    if(row.model&&row.evidence){
      // Shares the full peer index across folds. Per-fold entries hold only independent predictions.
      entry={stamp:row.stamp,model:row.model,families:row.evidence.families,
        reference:row.fold===-1?buildSelectedReference(row.evidence.donors.map(readDonor)):null,
        residuals:row.evidence.residuals?new Map(Object.entries(row.evidence.residuals)):undefined,storedBytes:row.storedBytes};
    }
    if(!entry)continue;
    remember(key,entry);
    result.set(referenceKey(row),entry);
  }
  return result;
}

/** Returns the owner's full model. Sharing needs a separate visibility-filtered projection. */
export async function personalModel(userId:string,medium:TasteMedium){
  return (await references(userId,[{medium,fold:-1}])).get(referenceKey({medium,fold:-1}))?.model??null;
}

export async function selectedItemMatches(userId:string,workIds:readonly string[],inspect=false,verified?:FeatureConfig){
  const result=new Map<string,PersonalItemMatch>();
  if(!workIds.length)return result;
  if(workIds.length>maxTasteBatchSize)throw new AppError(400,`Choose up to ${maxTasteBatchSize} titles.`);
  const config=verified??await requireFeature(userId,'personalisation');
  if(!config.features.personalisation)return result;
  const db=getSql(),ids=[...new Set(workIds.map(i=>i.toLowerCase()))];
  const targets=await trackReadQuery(()=>db<Target[]>`
    select w.id,w.kind,root.id as root,case when w.category='music' then 'music' else root.kind end as medium,
      member.fold,coalesce(u.settings->>'region','GB') as region,publication.published_at::text as stamp
    from works w ${tasteRootJoin(db)} join users u on u.id=${userId}::uuid and not u.disabled
    left join user_taste_match_members member on member.user_id=u.id and member.root=root.id
    left join user_taste_match_models publication on publication.user_id=u.id and publication.fold=-1
      and publication.medium=case when w.category='music' then 'music' else root.kind end
    where w.id=any(${db.array(ids,'UUID')}::uuid[]) and w.kind in ('movie','show','episode','season','album','track','artist','game','book','comic')
    and coast_category_enabled(u.id,w.category)`);
  if(!targets.length)return result;
  const primary=await references(userId,targets.map(t=>({medium:t.medium,fold:t.fold??-1})));
  const active=targets.filter(t=>{
    const full=primary.get(referenceKey({medium:t.medium,fold:-1}));
    const entry=t.fold===null?full:primary.get(referenceKey({medium:t.medium,fold:t.fold}));
    const pending=!entry||entry.stamp!==full?.stamp||full?.stamp!==t.stamp;
    if(!pending&&entry.model.works&&entry.model.affinities.length)return true;
    result.set(t.id,{root:t.root,withheld:t.fold!==null,pending,score:null,confidence:0,native:null,rule:null,signals:[],
      reason:pending?'Taste profile is being prepared':'Insufficient shared evidence'});
    return false;
  });
  if(!active.length)return result;
  const [features,metadata]=await Promise.all([
    workTasteFeatures([...new Set(active.flatMap(t=>[t.id,t.root]))],config.metadataSource,undefined,active[0].region,userId,true),
    matchMetadata([...new Set(active.filter(t=>t.medium==='show'||t.medium==='movie').map(t=>t.root))])
  ]);
  function keys(target:Target){
    const full=primary.get(referenceKey({medium:target.medium,fold:-1}));
    const aliases=full?.families??{};
    const linked=new Set(familyKeys(target.root,metadata.get(target.root)?.collections??[],features.get(target.root)??{})
      .flatMap(key=>Object.hasOwn(aliases,key)?[aliases[key]]:[]));
    const [family]=linked;
    return {full,family:family??target.root,ambiguous:linked.size>1,
      evidenceFold:target.fold??(family===undefined?-1:familyFold(family))};
  }
  const contexts=active.map(t=>({target:t,...keys(t)}));
  const missing=contexts.flatMap(({target:t,evidenceFold})=>{
    const key={medium:t.medium,fold:evidenceFold};
    return ['movie','show'].includes(t.medium)&&!primary.has(referenceKey(key))?[key]:[];
  });
  const related=await references(userId,missing);
  for(const {target:t,full,family,ambiguous,evidenceFold} of contexts){
    const withheld=t.fold!==null;
    const entry=withheld?primary.get(referenceKey({medium:t.medium,fold:t.fold!})):full;
    const match:PersonalItemMatch={root:t.root,withheld,pending:!entry||entry.stamp!==full?.stamp,
      score:null,native:null,rule:null,confidence:0,signals:[],reason:'Taste profile is being prepared'};
    result.set(t.id,match);
    if(!entry||match.pending)continue;
    const item=targetFeatures({...t,precise:t.id!==t.root},features);
    const own=scorePersonalTaste(entry.model,item,{details:inspect});
    Object.assign(match,{...own,native:own.score,rule:'personal'});
    if(own.score===null||ambiguous||(t.medium!=='movie'&&t.medium!=='show'))continue;
    const key=referenceKey({medium:t.medium,fold:evidenceFold});
    const evidence=primary.get(key)??related.get(key);
    if(!full?.reference||!evidence||evidence.stamp!==entry.stamp)continue;
    const work=selectedWork(t.root,family,t.medium,item,metadata.get(t.root)??{});
    const overrides=evidence.residuals?{exact:evidence.residuals,public:evidence.residuals}:undefined;
    const outcome=scoreSelected(full.reference,work,own.score,()=>selectedLowerScore(entry.model,item),overrides);
    match.score=outcome.score;match.rule=outcome.rule;
  }
  return result;
}
