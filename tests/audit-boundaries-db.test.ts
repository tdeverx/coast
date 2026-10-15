import { afterAll, beforeAll, expect, test } from 'bun:test';
import { getDb, getSql, closeDb } from '../src/lib/server/db';
import { ingestMetadata } from '../src/lib/catalogue/service.server';
import { track, bulkTrack, trackInTransaction } from '../src/lib/core/tracking/service.server';
import { createList, addListItem } from '../src/lib/core/lists/service.server';
import { mediaActionData } from '../src/lib/server/queries/media-actions';
import { progressData } from '../src/lib/server/queries/progress';
import { deleteUser, type SessionUser } from '../src/lib/server/auth';
import { friendInsights } from '../src/lib/social/insights.server';
import { recommend, respondRecommendation } from '../src/lib/social/service.server';
import { createApiToken } from '../src/lib/server/public-api/tokens.server';
import { createWebhook, deliverWebhook, emitWebhook } from '../src/lib/server/public-api/webhooks.server';
import { claimNextAction, retryAction } from '../src/lib/server/queue';
import { sql } from 'drizzle-orm';
import { importReading } from '../src/lib/catalogue/reading.server';
import { updateReading } from '../src/lib/core/reading/service.server';

const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const owner = crypto.randomUUID(), friend = crypto.randomUUID(), tag = crypto.randomUUID();
const actor: SessionUser = { id: owner, username: `audit-${tag}`, role: 'admin', email: null, settings: {} };

beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  const db = getSql();
  await db`insert into users(id,username,role) values(${owner},${actor.username},'admin'),(${friend},${'friend-'+tag},'user')`;
  await db`insert into friendships(user_a,user_b,requested_by,state) values(least(${owner}::uuid,${friend}::uuid),greatest(${owner}::uuid,${friend}::uuid),${owner},'accepted')`;
  await db`insert into system_settings(key,value) values('coast','{"experimentalMusic":true}') on conflict(key) do update set value=system_settings.value||excluded.value`;
});
afterAll(closeDb);

run('shared progress never includes a private playlist name or sequence context', async () => {
  const first = await ingestMetadata({ provider: 'tmdb', externalId: `private-first-${tag}`, kind: 'movie', title: 'First' });
  const second = await ingestMetadata({ provider: 'tmdb', externalId: `private-second-${tag}`, kind: 'movie', title: 'Second' });
  const list = await createList(owner, { name: `Private secret ${tag}`, playlist: true, mediaId: first.id });
  await addListItem(owner, list.id, second.id);
  await getSql()`update lists set playback_started_at=now() where id=${list.id}`;
  await track(owner, { mediaId: first.id, action: 'watch' });
  const own = await progressData(owner, { view: 'next', scope: 'all' });
  expect(JSON.stringify(own)).toContain(list.name);
  const shared = await progressData(owner, { view: 'next', scope: 'all' }, friend);
  expect(JSON.stringify(shared)).not.toContain(list.name);
  expect(JSON.stringify(shared)).not.toContain(list.id);
});

run('menu and release-date watches use enriched dates and real refresh identities', async () => {
  const db = getSql();
  const item = await ingestMetadata({ provider: 'tmdb', externalId: '1991988776', kind: 'movie', title: 'Release fixture', releaseDate: '2099-01-01' });
  const parent = await ingestMetadata({ provider: 'tmdb', externalId: `release-collection-${tag}`, kind: 'collection', title: 'Release collection' });
  await db`insert into media_relationships(parent_id,child_id,kind,position) values(${parent.id},${item.id},'collection',0)`;
  await ingestMetadata({ provider: 'tmdb', externalId: '1991988776', kind: 'movie', title: 'Release fixture', releaseDate: '2020-02-03' });
  // Fallback remains intentionally stale: operational decisions must use snapshots.
  expect(new Date((await db`select release_date from media where id=${item.id}`)[0].release_date).toISOString().slice(0, 10)).toBe('2099-01-01');
  const menu = await mediaActionData(owner, item.id);
  expect(menu.releaseDate).toBe('2020-02-03');
  expect(menu.refreshTarget?.tmdbId).toBe('1991988776');
  await bulkTrack(owner, { mediaId: parent.id, action: 'watch', onReleaseDate: true });
  expect(new Date((await db`select occurred_at from tracking_events where user_id=${owner} and media_id=${item.id} and action='watch'`)[0].occurred_at).toISOString()).toBe('2020-02-03T00:00:00.000Z');
  await db`insert into metadata_overrides(media_id,release_date) values(${item.id},'2098-01-01')`;
  expect((await mediaActionData(owner, item.id)).releaseDate).toBe('2098-01-01');
  const previous = (await db`select count(*)::int as total from tracking_events where user_id=${owner} and media_id=${item.id}`)[0].total;
  await expect(bulkTrack(owner, { mediaId: parent.id, action: 'watch', onReleaseDate: true })).rejects.toThrow('No titles or episodes');
  expect((await db`select count(*)::int as total from tracking_events where user_id=${owner} and media_id=${item.id}`)[0].total).toBe(previous);
});

run('new episodes invalidate completion without resetting history or dropped state', async () => {
  const db = getSql();
  const show = await ingestMetadata({ provider: 'tmdb', externalId: `projection-show-${tag}`, kind: 'show', title: 'Projection' });
  const season = await ingestMetadata({ provider: 'tmdb', externalId: `projection-season-${tag}`, kind: 'season', title: 'Season 1', seasonNumber: 1 }, { showId: show.id });
  const first = await ingestMetadata({ provider: 'tmdb', externalId: `projection-first-${tag}`, kind: 'episode', title: 'First', seasonNumber: 1, episodeNumber: 1 }, { showId: show.id, seasonId: season.id });
  await track(owner, { mediaId: first.id, action: 'watch' });
  await db`update tracking_state set dropped=true,play_count=7 where user_id=${owner} and media_id in (${show.id}::uuid,${season.id}::uuid)`;
  await ingestMetadata({ provider: 'tmdb', externalId: `projection-second-${tag}`, kind: 'episode', title: 'Second', seasonNumber: 1, episodeNumber: 2 }, { showId: show.id, seasonId: season.id });
  const parents = await db`select watched,total_episodes,completed_episodes,dropped,play_count from tracking_state where user_id=${owner} and media_id in (${show.id}::uuid,${season.id}::uuid)`;
  expect(parents).toHaveLength(2);
  for (const parent of parents) expect(parent).toMatchObject({ watched: false, total_episodes: 2, completed_episodes: 1, dropped: true, play_count: 7 });
  expect(await db`select id from tracking_events where user_id=${owner} and media_id=${first.id} and action='watch'`).toHaveLength(1);
});

run('disabled administrators can be deleted while the sole active administrator remains protected', async () => {
  const db = getSql(), disabled = crypto.randomUUID();
  await db`insert into users(id,username,role,disabled) values(${disabled},${'disabled-'+tag},'admin',true)`;
  await deleteUser(actor, disabled);
  expect(await db`select id from users where id=${disabled}`).toHaveLength(0);
  await expect(deleteUser(actor, owner)).rejects.toThrow();
  expect(await db`select id from users where id=${owner} and not disabled`).toHaveLength(1);
});

run('the first watch and a concurrent new episode leave fresh parent completion', async () => {
  const db = getDb();
  const show = await ingestMetadata({ provider: 'tmdb', externalId: `concurrent-show-${tag}`, kind: 'show', title: 'Concurrent show' });
  const season = await ingestMetadata({ provider: 'tmdb', externalId: `concurrent-season-${tag}`, kind: 'season', title: 'Season 1', seasonNumber: 1 }, { showId: show.id });
  const episode = await ingestMetadata({ provider: 'tmdb', externalId: `concurrent-first-${tag}`, kind: 'episode', title: 'First', seasonNumber: 1, episodeNumber: 1 }, { showId: show.id, seasonId: season.id });
  let release!: () => void, ready!: () => void;
  const gate = new Promise<void>(resolve => release = resolve);
  const held = new Promise<void>(resolve => ready = resolve);
  const watch = db.transaction(async tx => {
    await trackInTransaction(tx, owner, { mediaId: episode.id, action: 'watch' });
    ready();
    await gate;
  });
  void watch.catch(() => {});
  await held;
  const imported = ingestMetadata({ provider: 'tmdb', externalId: `concurrent-second-${tag}`, kind: 'episode', title: 'Second', seasonNumber: 1, episodeNumber: 2 }, { showId: show.id, seasonId: season.id });
  void imported.catch(() => {});
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const [state] = await getSql()`select exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock') as waiting`;
      if (state.waiting) { waiting = true; break; }
      await Bun.sleep(10);
    }
    expect(waiting).toBe(true);
    release();
    await Promise.all([watch, imported]);
    const parents = await getSql()`select watched,total_episodes,completed_episodes from tracking_state where user_id=${owner} and media_id in (${show.id}::uuid,${season.id}::uuid)`;
    expect(parents).toHaveLength(2);
    for (const parent of parents) expect(parent).toMatchObject({ watched: false, total_episodes: 2, completed_episodes: 1 });
  } finally {
    release();
    await Promise.allSettled([watch, imported]);
  }
});

run('taste counts and overlap pages remain exact beyond the scoring sample and use actual music progress', async () => {
  const db = getSql(), users = [crypto.randomUUID(), crypto.randomUUID()], music = crypto.randomUUID();
  for (const user of users) await db`insert into users(id,username) values(${user},${'taste-'+user})`;
  await db`insert into friendships(user_a,user_b,requested_by,state) values(least(${users[0]}::uuid,${users[1]}::uuid),greatest(${users[0]}::uuid,${users[1]}::uuid),${users[0]},'accepted')`;
  const works = await db`insert into works(category,kind) select 'screen','movie' from generate_series(1,321) returning id`;
  const ids = works.map((row: { id: string }) => row.id);
  await db`insert into media(id,kind,title) select id,'movie','Paged taste' from works where id in ${db(ids)}`;
  for (const user of users) await db`insert into tracking_state(user_id,media_id,collected) select ${user},id,true from works where id in ${db(ids)}`;
  const first = await friendInsights(users[0], users[1], { medium: 'movies' });
  const second = await friendInsights(users[0], users[1], { medium: 'movies', page: 2 });
  expect(first.total).toBe(321);
  expect(first.pages).toBe(6);
  expect(first.ids).toHaveLength(60);
  expect(second.ids).toHaveLength(60);
  expect(second.ids.some(id => first.ids.includes(id))).toBe(false);
  expect(first.media.find(row => row.medium === 'movies')?.overlapCounts.shared).toBe(321);
  expect(first.media.find(row => row.medium === 'movies')?.stats.you.total).toBe(321);
  expect(first.media.find(row => row.medium === 'movies')?.progressComparisons.every(row => row.you === 0 && row.friend === 0)).toBe(true);
  await db`insert into works(id,category,kind) values(${music},'music','track')`;
  await db`insert into music_works(id,title,kind) values(${music},'Progress fixture','track')`;
  for (const user of users) {
    await db`insert into tracking_state(user_id,media_id,collected) values(${user},${music},true)`;
    await db`insert into music_progress(user_id,track_id,position_seconds,duration_seconds) values(${user},${music},60,240)`;
  }
  const result = await friendInsights(users[0], users[1], { medium: 'music' });
  expect(result.media.find(row => row.medium === 'music')?.progressComparisons).toEqual([{ workId: music, you: 25, friend: 25 }]);
  const reading = crypto.randomUUID();
  await db`update system_settings set value=value||'{"experimentalBooks":true}'::jsonb where key='coast'`;
  await db`insert into works(id,category,kind) values(${reading},'book','book')`;
  for (const user of users) await db`insert into tracking_state(user_id,media_id,collected) values(${user},${reading},true)`;
  expect((await friendInsights(users[0], users[1])).total).toBe(322);
});

run('concurrent recommendation send and response share one lock order', async () => {
  const item = await ingestMetadata({ provider: 'tmdb', externalId: `lock-order-${tag}`, kind: 'movie', title: 'Lock order' });
  const recommendation = await recommend(owner, { recipientId: friend, workId: item.id });
  await Promise.all([
    recommend(owner, { recipientId: friend, workId: item.id }),
    respondRecommendation(friend, recommendation.id, { action: 'save' }),
  ]);
  expect(await getSql()`select id from social_recommendations where sender_id=${owner} and recipient_id=${friend} and work_id=${item.id}`).toHaveLength(1);
});

run('manual webhook Retry gets a fresh delivery budget without reusing an old lease attempt', async () => {
  const token = await createApiToken(actor, { name: 'Retry test', scopes: ['webhooks:manage'] });
  const db = getSql();
  await getDb().transaction(async tx => {
    await createWebhook(tx, owner, token.id, { url: 'https://1.1.1.1/coast-events', events: ['tracking.changed'] });
    await emitWebhook(tx, owner, 'tracking.changed', { workId: crypto.randomUUID() });
  });
  const [row] = await db`update outbox_actions set state='failed',attempts=8 where user_id=${owner} and kind='webhook.deliver' returning id`;
  await retryAction(actor, row.id);
  const action = await claimNextAction();
  expect(action?.id).toBe(row.id);
  expect(action?.attempts).toBe(9);
  const original = globalThis.fetch;
  let deliveries = 0;
  try {
    globalThis.fetch = Object.assign(async () => { deliveries++; return new Response(null, { status: 204 }); }, { preconnect: original.preconnect });
    await deliverWebhook(action!);
    expect(deliveries).toBe(1);
    await expect(deliverWebhook({ ...action!, attempts: 17 })).rejects.toThrow('failed repeatedly');
    expect(deliveries).toBe(1);
  } finally {
    globalThis.fetch = original;
  }
});

run('the active taste uniqueness invariant applies to the outbox and releases terminal entries', async () => {
  const db = getSql();
  await db`delete from outbox_actions where kind='taste.refresh'`;
  const [first] = await db`insert into outbox_actions(user_id,kind,payload) values(${owner},'taste.refresh','{}') returning id`;
  await expect((async () => {
    await db`insert into outbox_actions(user_id,kind,payload,state) values(${friend},'taste.refresh','{}','failed')`;
  })()).rejects.toThrow();
  await db`update outbox_actions set state='succeeded' where id=${first.id}`;
  expect(await db`insert into outbox_actions(user_id,kind,payload) values(${friend},'taste.refresh','{}') returning id`).toHaveLength(1);
  const [index] = await db`select tablename from pg_indexes where indexname='outbox_taste_one_active_idx'`;
  expect(index.tablename).toBe('outbox_actions');
});

run('ten reading transactions use their own configuration reads without needing an eleventh connection', async () => {
  const db = getDb();
  await getSql()`update system_settings set value=value||'{"experimentalBooks":true}'::jsonb where key='coast'`;
  const book = await importReading({ provider: 'openlibrary', externalId: 'OL9919876W', kind: 'book', title: 'Pool fixture', sourceUrl: 'https://openlibrary.org/works/OL9919876W', authors: [], subjects: [] });
  let release!: () => void, firstReady!: () => void, remainingReady!: () => void;
  const gate = new Promise<void>(resolve => release = resolve);
  const first = new Promise<void>(resolve => firstReady = resolve);
  const remaining = new Promise<void>(resolve => remainingReady = resolve);
  const writes: Promise<unknown>[] = [];
  let ready = 0;
  const prepare = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    // A regression must also fail and clean up, rather than leave a stuck test process.
    await tx.execute(sql`set local idle_in_transaction_session_timeout='6s'`);
    await tx.execute(sql`set local statement_timeout='6s'`);
  };
  writes.push(db.transaction(async tx => {
    await prepare(tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${owner},0))`);
    firstReady();
    await gate;
    return updateReading(owner, book.id, { state: 'reading', page: 1 }, tx);
  }));
  void Promise.allSettled(writes);
  await first;
  for (let index = 0; index < 9; index++) {
    writes.push(db.transaction(async tx => {
      await prepare(tx);
      if (++ready === 9) remainingReady();
      return updateReading(owner, book.id, { state: 'reading', page: 1 }, tx);
    }));
  }
  void Promise.allSettled(writes);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await remaining;
    const healthy = getSql()`select 1 as value`.then(rows => rows[0].value);
    release();
    const result = await Promise.race([
      Promise.all([...writes, healthy]),
      new Promise<never>((_, reject) => timeout = setTimeout(() => reject(new Error('Reading exhausted the database pool.')), 5000)),
    ]);
    expect(result.at(-1)).toBe(1);
    expect((await getSql()`select page from reading_progress where user_id=${owner} and work_id=${book.id}`)[0].page).toBe(1);
  } finally {
    clearTimeout(timeout);
    release();
    await Promise.allSettled(writes);
  }
}, 20_000);
