import { afterAll, expect, test } from 'bun:test';
import { closeDb, getSql } from '../src/lib/server/db';

const run = process.env.COAST_DB_TEST === '1' ? test : test.skip;
afterAll(closeDb);

run('reserved job locks survive provider waits beyond the former idle timeout', async () => {
  const pool = getSql();
  const worker = await pool.reserve();
  const contender = await pool.reserve();
  const key = `idle-worker-fixture:${crypto.randomUUID()}`;
  let acquiredByContender = false;
  try {
    const [{ pid }] = await worker`SELECT pg_backend_pid() AS pid`;
    await worker`SELECT pg_advisory_lock(hashtextextended(${key}, 0))`;
    // Keep unrelated reads active, as in the app, while the lock session waits
    // for an external service. Those reads cannot keep this reservation alive.
    for (let i = 0; i < 32; i++) {
      await Bun.sleep(1000);
      await pool`SELECT 1`;
    }
    expect((await worker`SELECT pg_backend_pid() AS pid`)[0].pid).toBe(pid);
    acquiredByContender = (await contender`SELECT pg_try_advisory_lock(hashtextextended(${key}, 0)) AS acquired`)[0].acquired;
    expect(acquiredByContender).toBe(false);
    await worker`SELECT pg_advisory_unlock(hashtextextended(${key}, 0))`;
    acquiredByContender = (await contender`SELECT pg_try_advisory_lock(hashtextextended(${key}, 0)) AS acquired`)[0].acquired;
    expect(acquiredByContender).toBe(true);
  } finally {
    if (acquiredByContender) await contender`SELECT pg_advisory_unlock(hashtextextended(${key}, 0))`;
    await worker.release();
    await contender.release();
  }
  expect((await pool`SELECT 1 AS healthy`)[0].healthy).toBe(1);
}, 45_000);
