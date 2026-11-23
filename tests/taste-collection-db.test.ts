import { beforeAll, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { getDb, getSql } from '../src/lib/server/db';
import { getFeatureConfig } from '../src/lib/server/features';
import { collectionTaste } from '../src/lib/social/collection-taste.server';
import { personalMatchRevision } from '../src/lib/social/taste-cache.server';
import { selectedItemMatches } from '../src/lib/social/taste-personal-match.server';
import { buildPersonalMatches, savePersonalMatches } from '../src/lib/social/taste-personal-publish.server';

const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const owner = crypto.randomUUID(), other = crypto.randomUUID();

beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  const db = getSql();
  await db`insert into users(id,username) values(${owner},'collection-taste-owner'),(${other},'collection-taste-other')`;
  await db`insert into system_settings(key,value) values('coast','{"experimentalComics":true}')
    on conflict(key) do update set value=excluded.value`;

  // Train on unrelated titles. Collection members remain unseen and score from their current metadata.
  for (const medium of ['movie', 'show', 'comic'] as const) {
    for (const [genre, rating] of [['Comedy', 4], ['Horror', 2]] as const) {
      const ids = db.array(Array.from({ length: 6 }, () => crypto.randomUUID()), 'UUID');
      if (medium === 'comic') {
        await db`insert into works(id,category,kind) select id,'comic','comic' from unnest(${ids}::uuid[]) h(id)`;
        await db`insert into reading_works(id,kind,provider,external_id,title,source_url,subjects)
          select id,'comic','comic-vine',id::text,'Rated comic','https://example.test/comic',array[${genre}::text]
          from unnest(${ids}::uuid[]) h(id)`;
      } else {
        await db`insert into media(id,kind,title,genres) select id,${medium},'Rated title',array[${genre}::text]
          from unnest(${ids}::uuid[]) h(id)`;
      }
      await db`insert into ratings(user_id,media_id,value) select ${owner},id,${rating} from unnest(${ids}::uuid[]) h(id)`;
    }
  }
  const config = await getFeatureConfig(owner, db);
  const publication = await buildPersonalMatches(owner, config, 'GB');
  const [row] = await getDb().execute<{revision:string}>(sql`select ${personalMatchRevision} as revision from users u where u.id=${owner}::uuid`);
  await getDb().transaction(tx => savePersonalMatches(tx, owner, row.revision, publication));
});

run('nested screen sets count each movie or show once, including shows represented by episodes', async () => {
  const db = getSql();
  const [set,nested,movie,show,episode] = Array.from({length:5}, () => crypto.randomUUID());
  await db`insert into media(id,kind,title) values
    (${set},'collection','Main set'),(${nested},'collection','Nested set'),(${movie},'movie','Film'),(${show},'show','Show'),(${episode},'episode','Episode')`;
  await db`insert into shows(media_id) values(${show})`;
  await db`insert into episodes(media_id,show_id,season_number,episode_number) values(${episode},${show},1,1)`;
  await db`insert into media_relationships(parent_id,child_id,kind) values
    (${set},${nested},'collection'),(${nested},${set},'franchise'),(${set},${episode},'collection'),
    (${nested},${movie},'franchise'),(${set},${movie},'collection')`;
  const empty = await collectionTaste(owner,set,'collection','recalculate');
  expect(empty?.breakdown).toEqual({watched:0,average:null,bonus:0,titles:expect.arrayContaining([
    {id:movie,title:'Film',score:null,confidence:0},{id:show,title:'Show',score:null,confidence:0},
  ])});
  await db`update media set genres=array['Comedy'] where id=${movie}`;
  expect(await collectionTaste(owner,set,'collection')).toEqual({score:null,members:{total:2,sampled:2,matched:1}});
  await db`update media set genres=array['Comedy'] where id=${show}`;
  const matches = await selectedItemMatches(owner,[movie,show]);
  const film = matches.get(movie)!, series = matches.get(show)!;
  expect(film.score).toBeGreaterThan(50);
  expect(series.score).toBeGreaterThan(50);
  const average = (film.score! + series.score!) / 2;
  const summary = {score:Math.round(average),members:{total:2,sampled:2,matched:2}};
  expect(await collectionTaste(owner,set,'collection')).toEqual(summary);
  await db`insert into media_relationships(parent_id,child_id,kind) values(${nested},${show},'collection')`;
  await db`insert into tracking_state(user_id,media_id,watched,play_count) values(${owner},${movie},true,8)`;
  expect(await collectionTaste(owner,set,'collection')).toEqual(summary);
  await db`insert into tracking_state(user_id,media_id,completed_episodes) values(${owner},${show},1)`;
  const bonus = Math.min(average-50,100-average)/4;
  expect(bonus).toBeGreaterThan(0);
  const withBonus = {...summary,score:Math.round(average+bonus)};
  expect(await collectionTaste(owner,set,'collection')).toEqual(withBonus);
  expect(await collectionTaste(owner,set,'collection','recalculate')).toEqual({...withBonus,
    breakdown:{watched:2,average,bonus,titles:expect.arrayContaining([
      {id:movie,title:'Film',score:film.score,confidence:film.confidence},
      {id:show,title:'Show',score:series.score,confidence:series.confidence},
    ])},
  });
  await db`update media set genres=array['Horror'] where id in (${movie},${show})`;
  const low = await collectionTaste(owner,set,'collection','recalculate');
  expect(low?.breakdown?.average).toBeLessThan(50);
  expect(low?.breakdown?.bonus).toBe(0);
  expect(low?.score).toBe(Math.round(low!.breakdown!.average!));
  expect(await collectionTaste(other,set,'collection')).toEqual({score:null,members:{total:2,sampled:2,matched:0}});
  expect(await collectionTaste(owner,show,'collection')).toBeNull();
});

run('a large set samples the full release order and withholds a score below half coverage', async () => {
  const db = getSql(), set = crypto.randomUUID();
  const ids = Array.from({length:48}, () => crypto.randomUUID());
  await db`insert into media(id,kind,title) values(${set},'collection','Large set')`;
  await db`insert into media(id,kind,title,release_date,genres)
    select id,'movie','Film ' || ord,date '2000-01-01'+ord::int,array[case when ord<=24 then 'Comedy' else 'Horror' end]
    from unnest(${db.array(ids,'UUID')}::uuid[]) with ordinality titles(id,ord)`;
  await db`insert into media_relationships(parent_id,child_id,kind)
    select ${set},id,'collection' from unnest(${db.array(ids,'UUID')}::uuid[]) titles(id)`;
  const matches = await selectedItemMatches(owner,[ids[0],ids[47]]);
  const early = matches.get(ids[0])!.score!, late = matches.get(ids[47])!.score!;
  expect(early).toBeGreaterThan(50);
  expect(late).toBeLessThan(50);
  const full = await collectionTaste(owner,set,'collection','recalculate');
  expect(full?.members).toEqual({total:48,sampled:24,matched:24});
  expect(full?.score).toBe(Math.round((early+late)/2));
  expect(full?.breakdown?.titles.map(title => title.id)).toEqual([
    ...ids.slice(0,46).filter((_, index) => index % 2 === 0), ids[47],
  ]);
  await db`update media set genres='{}' where id=any(${db.array(ids.slice(24),'UUID')}::uuid[])`;
  expect(await collectionTaste(owner,set,'collection')).toEqual({score:early,members:{total:48,sampled:24,matched:12}});
  await db`update media set genres='{}' where id=${ids[0]}`;
  expect(await collectionTaste(owner,set,'collection')).toEqual({score:null,members:{total:48,sampled:24,matched:11}});
});

run('comic volumes use verified local membership and enforce independent owner and category gates', async () => {
  const db = getSql(), group = crypto.randomUUID(), a = crypto.randomUUID(), b = crypto.randomUUID();
  await db`insert into reading_groups(id,provider,kind,external_id,title) values(${group},'comic-vine','comic','4050-9910001','Volume')`;
  expect(await collectionTaste(owner,group,'reading-group')).toBeNull();
  await db`insert into works(id,category,kind) values(${a},'comic','comic'),(${b},'comic','comic')`;
  await db`insert into reading_works(id,provider,kind,external_id,title,source_url,subjects)
    values(${a},'comic-vine','comic','4000-9910001','One','https://example.test/1',array['Comedy']),
          (${b},'comic-vine','comic','4000-9910002','Two','https://example.test/2',array['Horror'])`;
  await db`insert into reading_group_members(group_id,work_id,position) values(${group},${a},'1'),(${group},${b},'2')`;
  const matches = await selectedItemMatches(owner,[a,b]);
  const liked = matches.get(a)!.score!, disliked = matches.get(b)!.score!;
  expect(liked).toBeGreaterThan(50);
  expect(disliked).toBeLessThan(50);
  expect(await collectionTaste(owner,group,'reading-group')).toEqual({score:Math.round((liked+disliked)/2),members:{total:2,sampled:2,matched:2}});
  expect(await collectionTaste(other,group,'reading-group')).toEqual({score:null,members:{total:2,sampled:2,matched:0}});
  expect(await collectionTaste(owner,group,'collection')).toBeNull();
  await db`update users set settings='{"features":{"comic":false}}' where id=${other}`;
  await expect(collectionTaste(other,group,'reading-group')).rejects.toMatchObject({code:'experimental_disabled'});
  await db`update users set settings='{}',access_defaults='{"libraryOnly":true}' where id=${other}`;
  await expect(collectionTaste(other,group,'reading-group')).rejects.toMatchObject({code:'feature_disabled'});
});
