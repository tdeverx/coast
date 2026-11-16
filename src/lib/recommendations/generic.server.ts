import * as v from 'valibot';
import { sql } from 'drizzle-orm';
import { categoryEnabled } from '#lib/experimental.js';
import { workCards } from '#lib/collection/query.server.js';
import { getDb, getSql } from '#lib/server/db/index.js';
import { withReadCancellation } from '#lib/server/db/read-cancellation.js';
import { discoveryTitles } from '#lib/discovery.js';
import { getFeatureConfig } from '#lib/server/features.js';
import { PAGE_SIZE, pageNumberSchema, pagination } from '#lib/server/queries/pagination.js';
import { permittedMediaSources } from '#lib/server/queries/media.js';
import { AppError } from '#lib/server/security/errors.js';
import { publicMedia } from '#lib/social/public.server.js';
import { browseRowTitle, catalogueRowTitle } from './row-titles';
import { browseVariants, dynamicKinds, type BrowseVariant, type DynamicKind, type DynamicMedium, type DynamicRow } from './model';
import { browseSources, libraryKinds } from './browse-sources.server';
import { kindsByMedium, providerGenreKey, starterGenres, supportsProviderRow } from './row-catalog';
import { providerCards, unseenProviderCards } from './browse-remote.server';
import { rankRows } from './row-ranking';

const samplePerKind = 1000;
const mediumSchema = v.picklist(['screen', 'game', 'music', 'reading']);
const seedSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(64), v.regex(/^[a-zA-Z0-9-]+$/));
const genreSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(100));

async function discoveryScope(userId: string | null, url: URL, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const category = v.parse(mediumSchema, url.searchParams.get('category') ?? 'screen');
  const seed = v.parse(seedSchema, url.searchParams.get('seed') ?? new Date().toISOString().slice(0, 10));
  const config = await getFeatureConfig(userId, getSql());
  signal?.throwIfAborted();
  if (config.libraryOnly || (!userId && category !== 'screen') || !categoryEnabled(config, category))
    throw new AppError(404, 'This discovery medium is unavailable.', 'feature_disabled');
  const kinds = kindsByMedium[category].filter(kind => (kind!=='book' && kind!=='comic') || categoryEnabled(config,kind));
  return { category, seed, kinds, config };
}

// Discovery ranks catalogue metadata. Account connections only establish
// availability, never preferences, watch history or relevance.
function catalogue(category: DynamicMedium, userId: string | null, available: boolean, upcoming = false) {
  const source = () => category === 'screen' && userId
    ? sql`select media_id from (${permittedMediaSources(userId)}) permitted`
    : sql`select a.media_id from availability a join provider_connections c on c.id=a.connection_id
      join provider_instances i on i.id=c.instance_id and i.enabled
      where a.user_id=${userId} and c.user_id=${userId} and c.status='connected' and a.state='available'
      ${category === 'game' ? sql`and i.provider='steam' and a.source_id='steam-owned'` : sql`and i.provider='jellyfin'`}`;
  const titles = category === 'screen' ? sql`select item.id,item.kind,item.genres,item.release_date from media item
      where (${!!userId} or exists(select 1 from external_ids x where x.media_id=item.id and x.provider in ('tmdb','trakt')))`
    : category === 'game' ? sql`select item.id,'game'::text as kind,item.genres,item.release_date from games item where true`
    : category === 'music' ? sql`select item.id,item.kind,item.genres,item.release_date from music_works item where true`
    : sql`select item.id,item.kind,item.subjects as genres,item.release_date from reading_works item where true`;
  return sql`${titles} and ${upcoming ? sql`item.release_date>current_date and item.release_date<=current_date+90`
    : sql`(item.release_date is null or item.release_date<=current_date)`}
    ${available || category === 'music' ? sql`and item.id in (${source()})` : sql``}`;
}

export async function genericFeed(userId: string | null, url: URL, signal?: AbortSignal) {
  const { category, seed, kinds, config } = await discoveryScope(userId, url, signal);
  const selection = sql.join(kinds.map(kind => sql`(${kind}::text)`), sql`, `);
  const [counts, owned, sources] = await Promise.all([getDb().execute<{kind:DynamicKind;genre:string|null;total:number;upcoming:boolean}>(sql`
    with catalogue as not materialized (${catalogue(category, userId, false)}), sample as materialized (
      select title.* from (values ${selection}) k(kind)
      cross join lateral (select id,kind,genres from catalogue where kind=k.kind order by release_date desc nulls last,id limit ${samplePerKind}) title
    ), genres as (
      select kind,genre,count(*)::int as total from sample
      cross join lateral (select distinct genre from unnest(sample.genres) as g(genre) where length(trim(genre)) between 1 and 100) tags
      group by kind,genre having count(*)>=3
    )
    select kind,null::text as genre,count(*)::int as total,false as upcoming from sample group by kind
    union all
    (select kind,genre,total,false from genres order by total desc,kind,genre limit 24)
    union all
    select k.kind,null::text,1,true from (values ${selection}) k(kind)
      where ${category!=='music'} and exists (select 1 from (${catalogue(category,userId,false,true)}) future where future.kind=k.kind)`),
    libraryKinds(userId), browseSources(category,config.enableTrakt)]);
  signal?.throwIfAborted();
  const rows: (DynamicRow & { weight: number })[] = counts.filter(row=>!row.upcoming).map(({kind,genre,total}) =>
    genre === null
      ? {key:`catalogue:${kind}`,category,kind,surface:'recommendations',title:catalogueRowTitle(kind),weight:2}
      : {key:`genre:${kind}:${genre}`,category,kind,genre,surface:'genre',reason:'explore',title:catalogueRowTitle(kind,genre),weight:Math.min(12,Math.sqrt(total))});
  for (const kind of kinds) {
    const add = (variant: BrowseVariant, weight: number, genre?: string) => rows.push({
      key:`browse:${variant}:${kind}:${genre??''}`,surface:'browse',category,kind,variant,genre,title:browseRowTitle(kind,variant,genre),weight,
    });
    if (kind!=='album' && owned.has(kind)) {
      add('library',2);
      const genre = counts.find(row=>row.kind===kind && row.genre)?.genre;
      if (genre) add('library',2,genre);
    }
    if (counts.some(row=>row.kind===kind && row.upcoming)) add('upcoming',1);
    for (const variant of ['provider-popular','provider-rated','provider-upcoming'] as const) {
      if (supportsProviderRow(sources,kind,variant)) add(variant,variant==='provider-popular'?4:2);
    }
    const known = counts.filter(row=>row.kind===kind && row.genre).flatMap(row=>providerGenreKey(row.genre!,kind)??[]);
    for (const genre of [...new Set([...known, ...(starterGenres[kind]??[])])].slice(0,4)) {
      if (supportsProviderRow(sources,kind,'provider-genre',genre)) add('provider-genre',3,genre);
    }
  }
  const featured: DynamicRow[] = [];
  const trending = category==='screen' ? sources.screen || !!userId && config.enableRequests && sources.seerr
    : category==='game' ? sources.game : category==='music' ? owned.has('album') : kinds.includes('book');
  const recent = category==='screen' ? sources.tmdb : category==='game' ? sources.game
    : category==='music' ? owned.has('album') : kinds.includes('book') || kinds.includes('comic') && sources.comics;
  if (trending) featured.push({key:'discovery:trending',surface:'discovery',section:'trending',category,title:discoveryTitles.trending});
  if (recent) featured.push({key:'discovery:recent',surface:'discovery',section:'recent',category,title:discoveryTitles.recent});
  return {rows:[...featured,...rankRows(rows,seed).map(({weight,...row})=>row)]};
}

export async function genericRecommendationRows(userId: string | null, feature: 'row' | 'recommendations', url: URL, signal?: AbortSignal) {
  const { category, seed, kinds } = await discoveryScope(userId, url, signal);
  const kind = v.parse(v.picklist(dynamicKinds), url.searchParams.get('kind'));
  if (!kinds.includes(kind)) throw new AppError(404, 'This discovery type is unavailable.', 'feature_disabled');
  const genre = feature === 'row' ? v.parse(genreSchema,url.searchParams.get('genre')) : null;
  const number = v.parse(pageNumberSchema,Number(url.searchParams.get('page')??1));
  const available = url.searchParams.get('available')==='true';
  const {total,items} = await cataloguePage(userId,category,kind,number,seed,genre,available,false,signal);
  return {...pagination(total,number),total,items,title:catalogueRowTitle(kind,genre)};
}

async function cataloguePage(userId: string | null, category: DynamicMedium, kind: DynamicKind, number: number, seed: string,
  genre: string | null, available: boolean, upcoming: boolean, signal?: AbortSignal) {
  const dateOrder = upcoming ? sql`asc` : sql`desc nulls last`;
  const [row] = await getDb().execute<{total:number;ids:string[]}>(sql`
    with catalogue as not materialized (${catalogue(category,userId,available,upcoming)}), sample as materialized (
      select id,release_date from catalogue where kind=${kind}
      and (${genre}::text is null or ${genre}::text=any(genres))
      order by release_date ${dateOrder},id limit ${samplePerKind}
    ), count as (select count(*)::int as total from sample)
    select total,array(select id from sample
      order by case when ${genre}::text is not null then md5(${seed}||id::text) end,release_date ${dateOrder},id
      limit ${PAGE_SIZE} offset (least(${number},greatest(1,ceil(count.total::numeric/${PAGE_SIZE})::int))-1)*${PAGE_SIZE}) as ids from count`);
  signal?.throwIfAborted();
  const items = userId ? await workCards(userId,userId,row.ids) : await publicMedia(row.ids);
  signal?.throwIfAborted();
  return {total:row.total,items};
}

export async function browseRows(userId: string | null, mode: 'generic' | 'personal', url: URL, signal: AbortSignal) {
  const {category,kinds,config,seed} = await discoveryScope(userId,url,signal);
  const kind = v.parse(v.picklist(dynamicKinds),url.searchParams.get('kind'));
  const variant = v.parse(v.picklist(browseVariants),url.searchParams.get('variant'));
  const genre = url.searchParams.has('genre') ? v.parse(genreSchema,url.searchParams.get('genre')) : undefined;
  const number = v.parse(pageNumberSchema,Number(url.searchParams.get('page')??1));
  if (mode==='personal' && (!userId || !config.features.personalisation))
    throw new AppError(403,'Personalisation is turned off.','feature_disabled');
  const personalisedVariant = variant==='provider-genre' || variant==='provider-rated' || variant==='provider-upcoming';
  if (!kinds.includes(kind) || (mode==='personal' && (!genre || !personalisedVariant)) || (!userId && variant==='library')
    || (genre && variant!=='library' && !personalisedVariant))
    throw new AppError(404,'This discovery row is unavailable.','feature_disabled');
  const title = browseRowTitle(kind,variant,genre);
  if (variant==='library' || variant==='upcoming') {
    const {total,items} = await withReadCancellation(signal,()=>cataloguePage(userId,category,kind,number,seed,genre??null,variant==='library',variant==='upcoming',signal));
    return {...pagination(total,number),total,items,title};
  }
  const sources = await withReadCancellation(signal,()=>browseSources(category,config.enableTrakt));
  if (!supportsProviderRow(sources,kind,variant,genre)) throw new AppError(404,'This provider row is unavailable.','feature_disabled');
  const providerItems = await providerCards(userId,kind,variant,genre,signal,sources.igdbId);
  signal.throwIfAborted();
  const items = mode==='personal' && userId ? await withReadCancellation(signal,()=>unseenProviderCards(userId,providerItems)) : providerItems;
  return {page:1,pages:1,total:items.length,items,title};
}
