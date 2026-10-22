import {sql} from 'drizzle-orm';
import * as v from 'valibot';
import {workCards} from '#lib/collection/query.server.js';
import {getDb} from '../db';
import {getFeatureConfig} from '../features';
import {requireEnabledCategory} from '../experimental';
import {hasPermittedWorkSource} from './media';
import {libraryOrder} from './library-order';
import {librarySortValues,type LibraryContent} from '#lib/library.js';
import {PAGE_SIZE,pageNumberSchema,pagination,requestedPageInterval} from './pagination';
import {pageInterval} from '#lib/page-window.js';

/** Containers page their own identities; membership and access are tested before counting. */
export async function libraryContainers(userId:string,url:URL,signal?:AbortSignal):Promise<LibraryContent>{
  const parameters=url.searchParams,playlist=parameters.get('selection')==='playlist';
  const sort=v.parse(v.picklist(librarySortValues),parameters.get('sort')??'default');
  const scope=v.parse(v.picklist(['all','available']),parameters.get('scope')??'all');
  const requested=v.parse(pageNumberSchema,Number(parameters.get('page')??1));
  const interval=requestedPageInterval(requested,parameters.get('firstPage'));
  requireEnabledCategory(await getFeatureConfig(userId),playlist?'music':'comic');
  signal?.throwIfAborted();
  const available=hasPermittedWorkSource(userId);
  const personal=sql`exists(select 1 from tracking_state t where t.user_id=${userId} and t.media_id=w.id and (t.collected or t.watchlist or t.favourite))
    or exists(select 1 from reading_progress p where p.user_id=${userId} and p.work_id=w.id)
    or exists(select 1 from list_items li join lists l on l.id=li.list_id where l.user_id=${userId} and li.media_id=w.id)`;
  const eligible=playlist?sql`
    select l.id,l.name as title,l.created_at,l.updated_at
    from lists l where l.user_id=${userId} and l.playlist and not exists(
      select 1 from list_items li join works w on w.id=li.media_id where li.list_id=l.id and w.category<>'music')
      and (${scope}='all' or exists(select 1 from list_items li join works on works.id=li.media_id left join media on media.id=works.id where li.list_id=l.id and ${available}))
  `:sql`
    select g.id,g.title,min(w.created_at) as created_at,max(r.updated_at) as updated_at
    from reading_groups g join reading_group_members gm on gm.group_id=g.id
      join reading_works r on r.id=gm.work_id join works w on w.id=r.id
    where g.provider='comic-vine' and g.kind='comic' and exists(
      select 1 from reading_group_members candidate join works on works.id=candidate.work_id left join media on media.id=works.id
      where candidate.group_id=g.id and (${scope}='all' or ${available})
        and (${parameters.get('collection')!=='true'} or exists(select 1 from works w where w.id=candidate.work_id and (${personal}))))
    group by g.id,g.title
  `;
  const order=libraryOrder(sort,{title:sql`title`,added:sql`created_at`,id:sql`id`},sql`updated_at desc,id`);
  type Result={total:number;items:{id:string;title:string}[]};
  const [result]=await getDb().execute(sql`
    with eligible as materialized (${eligible}),total as(select count(*)::int as total from eligible)
    select total,coalesce((select jsonb_agg(page order by ${order}) from (
      select * from eligible order by ${order}
      limit (least(${requested},greatest(1,ceil(total::numeric/${PAGE_SIZE})::int))-least(${interval?.firstPage??requested},greatest(1,ceil(total::numeric/${PAGE_SIZE})::int))+1)*${PAGE_SIZE}
      offset (least(${interval?.firstPage??requested},greatest(1,ceil(total::numeric/${PAGE_SIZE})::int))-1)*${PAGE_SIZE}
    ) page),'[]'::jsonb) as items from total`) as unknown as Result[];
  signal?.throwIfAborted();
  const {page,pages}=pagination(result.total,requested),bounds=pageInterval(pages,page,interval?.firstPage);
  type Detail={id:string;members:number;poster:string|null;cover_id:string|null};
  const ids=`{${result.items.map(item=>item.id).join(',')}}`;
  // Only the retained page identities receive membership counts and artwork.
  const details=result.items.length?await getDb().execute(playlist?sql`
    select l.id,(select count(*)::int from list_items li where li.list_id=l.id) as members,
      null::text as poster,(select li.media_id from list_items li join music_works m on m.id=li.media_id where li.list_id=l.id order by li.position,li.id limit 1) as cover_id
    from lists l where l.user_id=${userId} and l.id=any(${ids}::uuid[])`:sql`
    select g.id,(select count(*)::int from reading_group_members gm where gm.group_id=g.id) as members,
      (select r.cover_url from reading_group_members gm join reading_works r on r.id=gm.work_id
        where gm.group_id=g.id and r.cover_url is not null order by gm.position,r.id limit 1) as poster,null::uuid as cover_id
    from reading_groups g where g.id=any(${ids}::uuid[])`) as unknown as Detail[]:[];
  signal?.throwIfAborted();
  const byId=new Map(details.map(item=>[item.id,item]));
  const covers=new Map<string,string|null|undefined>();
  const coverIds=[...new Set(details.flatMap(item=>item.cover_id?[item.cover_id]:[]))];
  for(let offset=0;offset<coverIds.length;offset+=PAGE_SIZE){
    signal?.throwIfAborted();
    for(const item of await workCards(userId,userId,coverIds.slice(offset,offset+PAGE_SIZE)))
      covers.set('workId' in item?item.workId??item.id:item.id,item.poster);
  }
  signal?.throwIfAborted();
  const items:LibraryContent['items']=result.items.map(item=>{
    const detail=byId.get(item.id);
    return {id:item.id,kind:'collection',title:item.title,poster:detail?.poster??covers.get(detail?.cover_id??''),
      captionSubtitle:`${detail?.members??0} ${playlist?'tracks':'issues'}`,href:playlist?`/lists?view=${item.id}`:`/media/reading-collection/${item.id}`};
  });
  return {items,page,pages,total:result.total,...(interval?{range:{...bounds,counts:Array.from({length:page-bounds.firstPage+1},(_,index)=>items.slice(index*PAGE_SIZE,(index+1)*PAGE_SIZE).length)}}:{})};
}
