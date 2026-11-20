import { beforeAll, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { getDb, getSql } from '../src/lib/server/db';
import { collectionTaste } from '../src/lib/social/collection-taste.server';
import { tasteRevisionSql } from '../src/lib/social/taste-cache.server';

const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const owner = crypto.randomUUID(), other = crypto.randomUUID();
let revision: string;

beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  const db = getSql();
  await db`insert into users(id,username) values(${owner},'collection-taste-owner'),(${other},'collection-taste-other')`;
  await db`insert into system_settings(key,value) values('coast','{"experimentalComics":true}')
    on conflict(key) do update set value=excluded.value`;
  const [row] = await getDb().execute<{revision:string}>(sql`select ${tasteRevisionSql} as revision from users u where u.id=${owner}::uuid`);
  revision = row.revision;
  await db`insert into user_taste_profiles(user_id,medium,revision,profile)
    select ${owner},medium,${revision},'{"works":6,"dimensions":{}}' from unnest(array['movie','show','comic']) medium`;
});

async function cached(id: string, score: number) {
  await getSql()`insert into user_taste_scores(user_id,work_id,revision,score,confidence,breakdown)
    values(${owner},${id},${revision},${score},60,${{score,confidence:60,matches:2,dimensions:{},reasons:[]}}::jsonb)`;
}

run('nested screen sets count each movie or show once, including shows represented by episodes', async () => {
  const db = getSql();
  const [set,nested,movie,show,episode] = Array.from({length:5}, () => crypto.randomUUID());
  await db`insert into media(id,kind,title) values
    (${set},'collection','Main set'),(${nested},'collection','Nested set'),(${movie},'movie','Film'),(${show},'show','Show'),(${episode},'episode','Episode')`;
  await db`insert into shows(media_id) values(${show})`;
  await db`insert into episodes(media_id,show_id,season_number,episode_number) values(${episode},${show},1,1)`;
  await db`insert into media_relationships(parent_id,child_id,kind) values
    (${set},${nested},'collection'),(${nested},${set},'franchise'),(${set},${episode},'collection'),
    (${nested},${movie},'franchise'),(${set},${movie},'collection'),(${nested},${show},'collection')`;
  await cached(movie,80);
  expect(await collectionTaste(owner,set,'collection')).toEqual({score:null,members:{total:2,sampled:2,matched:1}});
  await cached(show,20);
  expect(await collectionTaste(owner,set,'collection')).toEqual({score:50,members:{total:2,sampled:2,matched:2}});
  expect(await collectionTaste(other,set,'collection')).toEqual({score:null,members:{total:2,sampled:2,matched:0}});
  expect(await collectionTaste(owner,show,'collection')).toBeNull();
});

run('a large set samples the full release order and withholds a score below half coverage', async () => {
  const db = getSql(), set = crypto.randomUUID();
  const ids = Array.from({length:48}, () => crypto.randomUUID());
  await db`insert into media(id,kind,title) values(${set},'collection','Large set')`;
  await db`insert into media(id,kind,title,release_date)
    select id,'movie','Film ' || ord,date '2000-01-01'+ord::int from unnest(${db.array(ids,'UUID')}::uuid[]) with ordinality titles(id,ord)`;
  await db`insert into media_relationships(parent_id,child_id,kind)
    select ${set},id,'collection' from unnest(${db.array(ids,'UUID')}::uuid[]) titles(id)`;
  await db`insert into user_taste_scores(user_id,work_id,revision,score,confidence,breakdown)
    select ${owner},id,${revision},fit,60,jsonb_build_object('score',fit,'confidence',60,'matches',2,'reasons','[]'::jsonb,'dimensions','{}'::jsonb)
    from unnest(${db.array(ids,'UUID')}::uuid[]) with ordinality t(id,ord)
    cross join lateral (select case when ord <= 24 then 80 else 20 end as fit) scores`;
  expect(await collectionTaste(owner,set,'collection')).toEqual({score:50,members:{total:48,sampled:24,matched:24}});
  await db`delete from user_taste_scores where user_id=${owner} and work_id=any(${db.array(ids.slice(24),'UUID')}::uuid[])`;
  expect(await collectionTaste(owner,set,'collection')).toEqual({score:80,members:{total:48,sampled:24,matched:12}});
  await db`delete from user_taste_scores where user_id=${owner} and work_id=${ids[0]}`;
  expect(await collectionTaste(owner,set,'collection')).toEqual({score:null,members:{total:48,sampled:24,matched:11}});
});

run('comic volumes use verified local membership and enforce independent owner and category gates', async () => {
  const db = getSql(), group = crypto.randomUUID(), a = crypto.randomUUID(), b = crypto.randomUUID();
  await db`insert into reading_groups(id,provider,kind,external_id,title) values(${group},'comic-vine','comic','4050-9910001','Volume')`;
  expect(await collectionTaste(owner,group,'reading-group')).toBeNull();
  await db`insert into works(id,category,kind) values(${a},'comic','comic'),(${b},'comic','comic')`;
  await db`insert into reading_works(id,provider,kind,external_id,title,source_url)
    values(${a},'comic-vine','comic','4000-9910001','One','https://example.test/1'),
          (${b},'comic-vine','comic','4000-9910002','Two','https://example.test/2')`;
  await db`insert into reading_group_members(group_id,work_id,position) values(${group},${a},'1'),(${group},${b},'2')`;
  await cached(a,70);
  await cached(b,80);
  expect(await collectionTaste(owner,group,'reading-group')).toEqual({score:75,members:{total:2,sampled:2,matched:2}});
  expect(await collectionTaste(owner,group,'collection')).toBeNull();
  await db`update users set settings='{"features":{"comic":false}}' where id=${other}`;
  await expect(collectionTaste(other,group,'reading-group')).rejects.toMatchObject({code:'experimental_disabled'});
  await db`update users set settings='{}',access_defaults='{"libraryOnly":true}' where id=${other}`;
  await expect(collectionTaste(other,group,'reading-group')).rejects.toMatchObject({code:'feature_disabled'});
});
