import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {getSql, closeDb} from '../src/lib/server/db';
import {runtimeEvidence} from '../src/lib/server/diagnostics/runtime';

const target = process.env.TEST_DATABASE_URL;
const enabled = process.env.COAST_DB_TEST === '1' && !!target &&
  new URL(target).pathname.startsWith('/coast_settings_test_');

describe.skipIf(!enabled)('Bun SQL failure isolation on a disposable database', () => {
  beforeAll(async () => { process.env.DATABASE_URL = target; await closeDb(); });
  afterAll(async () => { await closeDb(); });

  test('application pool callbacks are observable without importing diagnostics in migration source', async () => {
    const before = runtimeEvidence.measurements();
    const [row] = await getSql()`SELECT 1::int AS marker`;
    expect(row.marker).toBe(1);
    expect(runtimeEvidence.measurements().connectionsOpened).toBeGreaterThan(before.connectionsOpened);
  });

  test('client parameter encoding failure preserves a reserved connection and concurrent work', async () => {
    const reserved = await getSql().reserve();
    try {
      const [before] = await reserved`SELECT pg_backend_pid()::int AS pid`;
      const results = await Promise.allSettled([
        reserved`SELECT ${{a: 1n}}::jsonb AS invalid`,
        reserved`SELECT 202::int AS marker`,
      ]);
      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('fulfilled');
      if (results[1].status === 'fulfilled') expect(results[1].value[0].marker).toBe(202);
      const [after] = await reserved`SELECT pg_backend_pid()::int AS pid`;
      expect(after.pid).toBe(before.pid);
    } finally { reserved.release(); }
  });

  test('multidimensional result handling cannot break concurrent work or mix pipeline results', async () => {
    const reserved = await getSql().reserve();
    try {
      const [before] = await reserved`SELECT pg_backend_pid()::int AS pid`;
      const results = await Promise.allSettled([
        reserved`SELECT ARRAY[[1,2],[3,4]]::int[][] AS unsupported`,
        reserved`SELECT 303::int AS marker`,
        reserved`SELECT 404::int AS marker`,
      ]);
      // Some server/protocol combinations decode this value successfully. If
      // decoding rejects, only its query may fail; success is also valid here.
      expect(results[1].status).toBe('fulfilled');
      expect(results[2].status).toBe('fulfilled');
      if (results[1].status === 'fulfilled') expect(results[1].value[0].marker).toBe(303);
      if (results[2].status === 'fulfilled') expect(results[2].value[0].marker).toBe(404);
      const [after] = await reserved`SELECT pg_backend_pid()::int AS pid`;
      expect(after.pid).toBe(before.pid);
    } finally { reserved.release(); }
  });

  test('swallowing a statement error cannot report a rolled-back transaction as committed', async () => {
    await getSql().unsafe('CREATE TABLE runtime_rollback_probe (value int PRIMARY KEY)');
    try {
      const transaction = getSql().begin(async sql => {
        await sql`INSERT INTO runtime_rollback_probe VALUES (1)`;
        try { await sql`INSERT INTO runtime_rollback_probe VALUES (1)`; } catch { /* fixture for swallowed errors */ }
        return 'must not commit';
      });
      await expect(transaction).rejects.toMatchObject({code: 'ERR_POSTGRES_COMMIT_ROLLED_BACK'});
      const [row] = await getSql()`SELECT count(*)::int AS count FROM runtime_rollback_probe`;
      expect(row.count).toBe(0);
    } finally { await getSql().unsafe('DROP TABLE runtime_rollback_probe'); }
  });
});
