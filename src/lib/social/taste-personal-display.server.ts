import {getSql} from '#lib/server/db/index.js';
import {trackReadQuery} from '#lib/server/db/read-cancellation.js';
import {personalModel} from './taste-personal-match.server';
import type {PersonalTasteProfile} from './taste-personal';
import type {TasteMedium} from './taste-profile';
import {tasteV2AffinityUses,type TasteV2Affinity} from './taste-v2';

const pages = new WeakMap<PersonalTasteProfile,Map<string,TasteV2Affinity[]>>();

/** Only the owner reads this projection. Page before hydrating example titles. */
export async function personalSignalPage(owner:string,medium:TasteMedium,dimension:string,page:number) {
  const profile=await personalModel(owner,medium);
  if(!profile)return null;
  let groups=pages.get(profile);
  if(!groups) {
    groups=new Map(profile.dimensions.map(name=>[name,[]]));
    for(const trait of profile.affinities)groups.get(trait.dimension)?.push(trait);
    const strength=(trait:TasteV2Affinity)=>Math.abs(trait.affinity-50)*trait.confidence;
    for(const traits of groups.values())traits.sort((a,b)=>strength(b)-strength(a)||b.independent-a.independent||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
    pages.set(profile,groups);
  }
  const values=groups.get(dimension)??[];
  const items=values.slice((page-1)*25,page*25);
  const ids=[...new Set(items.flatMap(item=>[...item.supporting.slice(0,1),...item.contradicting.slice(0,1)]))];
  const sql=getSql();
  const examples=ids.length?await trackReadQuery(()=>sql<{id:string;title:string}[]>`select w.id,coalesce(m.title,a.title,g.title,b.title) as title
    from works w left join media m on m.id=w.id left join music_works a on a.id=w.id
    left join games g on g.id=w.id left join reading_works b on b.id=w.id
    where w.id=any(${sql.array(ids,'UUID')}::uuid[])`):[];
  return {works:profile.works,ratings:profile.ratings,dimensions:[...groups].map(([key,entries])=>({key,count:entries.length})),
    items,pages:Math.max(1,Math.ceil(values.length/25)),uses:Object.fromEntries(items.map(trait=>[trait.id,tasteV2AffinityUses(profile,trait)])),
    examples:Object.fromEntries(examples.map(e=>[e.id,e.title]))};
}
