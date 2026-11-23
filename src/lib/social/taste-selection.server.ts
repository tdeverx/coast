import { sql, type SQL } from 'drizzle-orm';
import { getDb, getSql } from '#lib/server/db/index.js';
import { permittedMediaSources } from '#lib/server/queries/media.js';
import { ownedGameAvailable } from '#lib/games/availability.server.js';
import { assertJobLease } from '#lib/server/queue/execution.js';
import type { MetadataPolicy } from '#lib/catalogue/metadata/resolve.js';
import { workTasteFeatures } from './work-features.server';
import type { TasteMedium } from './taste-profile';
import type { createTasteSelectionTrainer } from './taste-selection';

type Trainer = ReturnType<typeof createTasteSelectionTrainer>;
export type TasteOpportunity = { id: string; medium: TasteMedium; available: boolean; poolSize: number; chosen: number; observed: boolean };

const samplePerPool = 3_000;
const otherMediaPerPool = 1_500;
const pageSize = 300;

/** Sample released, comparable works from the viewer's library and, when enabled, the discovery catalogue. */
export async function tasteOpportunityIds(userId: string, media: readonly TasteMedium[], libraryOnly = false, known: ReadonlyMap<string, boolean> = new Map(), includeChosen = false) {
  const sources: SQL[] = [];
  const screen = media.filter(medium => medium === 'movie' || medium === 'show');
  const reading = media.filter(medium => medium === 'book' || medium === 'comic');
  if (screen.length) sources.push(sql`
    select m.id, m.kind as medium, a.media_id is not null as available
    from media m left join allowed a on a.media_id=m.id
    where m.kind in (${sql.join(screen.map(kind => sql`${kind}`), sql`,`)}) and m.release_date<=current_date
  `);
  if (media.includes('game')) sources.push(sql`
    select games.id, 'game' as medium, ${ownedGameAvailable(userId)} as available
    from games where games.release_date<=current_date
  `);
  if (media.includes('music')) sources.push(sql`
    select m.id, 'music' as medium, a.media_id is not null or exists(
      select 1 from media_relationships member join allowed child on child.media_id=member.child_id
      where member.parent_id=m.id and member.kind='contains'
    ) as available
    from music_works m left join allowed a on a.media_id=m.id
    where m.kind='album' and coalesce(m.release_date<=current_date, m.year<=extract(year from current_date), false)
  `);
  if (reading.length) sources.push(sql`
    select r.id, r.kind as medium, a.media_id is not null as available
    from reading_works r left join allowed a on a.media_id=r.id
    where r.kind in (${sql.join(reading.map(kind => sql`${kind}`), sql`,`)})
      and coalesce(r.release_date<=current_date, r.published_year<=extract(year from current_date), false)
  `);
  if (!sources.length) return [];
  const chosenIds: string[] = [], otherIds: string[] = [];
  for (const [id, chosen] of known) (chosen ? chosenIds : otherIds).push(id);
  return await getDb().execute(sql`
    with allowed as materialized (select distinct media_id from (${permittedMediaSources(userId)}) source),
    history as (
      select id, true as chosen from unnest(${'{'+chosenIds.join(',')+'}'}::uuid[]) h(id)
      union all select id,false from unnest(${'{'+otherIds.join(',')+'}'}::uuid[]) h(id)
    ), census as (
      select titles.*, h.id is null as unseen,h.chosen as observed,
        count(*) filter(where h.id is null) over pool as "poolSize",
        count(*) filter(where h.chosen) over pool as chosen
      from (${sql.join(sources, sql` union all `)}) titles left join history h using(id)
      where (${!libraryOnly} or available)
      window pool as (partition by medium,available)
    ), picked as (
      select *,row_number() over(partition by medium,available order by hashtextextended(id::text,19),id) as rank
      from census where unseen
    )
    select id,medium,available,"poolSize"::float8,chosen::float8,false as observed from picked where rank<=case when medium in ('movie','show') then ${samplePerPool} else ${otherMediaPerPool} end
    ${includeChosen ? sql`union all select id,medium,available,"poolSize"::float8,chosen::float8,true as observed from census where observed` : sql``}
  `) as TasteOpportunity[];
}

/** Today's library and the viewer's historical choices are both incomplete exposure estimates.
 * Blend their odds equally in log space, with a small supply prior for sparse choices.
 * A weight never exceeds one: expansion of a sampled pool cannot invent evidence.
 */
export function opportunityPoolWeights(titles: readonly TasteOpportunity[]) {
  const pools = new Map<TasteMedium, Map<boolean, {sample:number; size:number; chosen:number}>>();
  for (const row of titles) {
    let medium = pools.get(row.medium);
    if (!medium) pools.set(row.medium, medium = new Map());
    let pool = medium.get(row.available);
    if (!pool) medium.set(row.available, pool = {sample:0,size:row.poolSize,chosen:row.chosen});
    pool.sample++;
  }
  const weights = new Map<TasteMedium,Map<boolean,number>>();
  for (const [medium, entries] of pools) {
    const size = [...entries.values()].reduce((n,p)=>n+p.size,0);
    const rates = new Map([...entries].map(([key,p])=>{
      const supply=p.size/size;
      return [key,Math.sqrt(supply*(p.chosen+8*supply))/p.sample] as const;
    }));
    const maximum = Math.max(...rates.values());
    weights.set(medium,new Map([...rates].map(([key,rate])=>[key,rate/maximum])));
  }
  return weights;
}

export async function addTasteOpportunities(
  userId: string, policy: MetadataPolicy, region: string, libraryOnly: boolean,
  trainers: Partial<Record<TasteMedium, Trainer>>, known: ReadonlyMap<string, boolean>,
) {
  const media = Object.keys(trainers) as TasteMedium[];
  if (!media.length) return;
  const opportunities = await tasteOpportunityIds(userId, media, libraryOnly, known);
  const weights = opportunityPoolWeights(opportunities);
  for (let offset = 0; offset < opportunities.length; offset += pageSize) {
    await assertJobLease(getSql());
    const batch = opportunities.slice(offset, offset + pageSize);
    const features = await workTasteFeatures(batch.map(title => title.id), policy, undefined, region);
    for (const { id, medium, available } of batch) trainers[medium]?.addCatalogue(features.get(id) ?? {},weights.get(medium)!.get(available)!);
  }
}
