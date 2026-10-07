import { afterAll, beforeAll, expect, test } from 'bun:test';
import { getSql } from '../src/lib/server/db';
import { TraktAdapter } from '../src/lib/providers/trakt/adapter.server';
import { persistMissingTmdb, scanTraktCatalogue } from '../src/lib/catalogue/maintenance.server';
import { JobYield, jobExecution, jobCheckpoint, readJobCheckpoint, saveJobCheckpoint } from '../src/lib/server/queue/execution';

const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
const user = crypto.randomUUID(), action = crypto.randomUUID();
const base = 1600000000 + Math.floor(Math.random() * 1000000);
beforeAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  await getSql()`insert into users(id,username) values(${user},${`catalogue-cursor-${user}`})`;
  await getSql()`insert into outbox_actions(id,user_id,kind,state,attempts,payload) values(${action},${user},'catalogue.user-scan','running',1,'{"_jobPurpose":"scheduled"}'::jsonb)`;
});
afterAll(async () => {
  if (process.env.COAST_DB_TEST !== '1') return;
  await getSql()`delete from works where id in (select media_id from external_ids where provider='tmdb' and external_id::text between ${String(base)} and ${String(base + 101)})`;
  await getSql()`delete from users where id=${user}`;
});

run('catalogue releases its lane with a durable cursor after committed metadata, then resumes without earlier pages', async () => {
  const paths: string[] = [];
  const adapter = new TraktAdapter(async path => {
    paths.push(path);
    if (path.includes('/sync/history?')) return path.includes('page=1&')
      ? Array.from({ length: 100 }, (_, index) => ({ movie: { title: 'Metadata reference', ids: { trakt: base + index, tmdb: base + index } } })) : [];
    if (path.includes('/sync/watchlist?')) return [{ movie: { title: 'Watchlist reference', ids: { trakt: base + 100, tmdb: base + 100 } } }];
    return [];
  }, 'client', 'secret', 'token');
  let added = 0;
  const save: typeof persistMissingTmdb = async (...args) => {
    const created = await persistMissingTmdb(...args); if (created) added++; return created;
  };
  const committed = async (cursor: unknown) => {
    // A concurrent request promotion must survive task cursor updates.
    await getSql()`update outbox_actions set payload=payload||'{"_jobPurpose":"manual"}'::jsonb where id=${action}`;
    await saveJobCheckpoint({ task: 'user-catalogue', provider: 'trakt', cursor, added });
    await jobCheckpoint();
  };
  const execution = () => ({ id: action, attempts: 1, purpose: 'scheduled' as const, started: performance.now(), checkpoints: 0 });
  await expect(jobExecution.run(execution(), () => scanTraktCatalogue(adapter, save, { committed }))).rejects.toBeInstanceOf(JobYield);
  const [row] = await getSql()`select payload from outbox_actions where id=${action}`;
  expect(row.payload._jobPurpose).toBe('manual');
  expect(row.payload._checkpoint).toMatchObject({ task: 'user-catalogue', provider: 'trakt', added: 100, cursor: { stage: 4, page: 1, listIds: [] } });
  const [evidence] = await getSql()`select count(*)::int as metadata,(select count(*)::int from tracking_state where user_id=${user}) as personal from external_ids where provider='tmdb' and external_id::text between ${String(base)} and ${String(base + 100)}`;
  expect(evidence.metadata).toBe(100); expect(evidence.personal).toBe(0);
  const checkpoint = await jobExecution.run(execution(), readJobCheckpoint);
  const before = paths.length;
  await scanTraktCatalogue(adapter, save, { cursor: checkpoint!.cursor as NonNullable<Parameters<typeof scanTraktCatalogue>[2]>['cursor'] });
  expect(paths.slice(before).some(path => /history|playback|collection\/movies/.test(path))).toBe(false);
  expect(added).toBe(101);
});
