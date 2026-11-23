// Historical row-scorer benchmark. DATABASE_URL must point to a disposable local database named taste_card_benchmark.
// bun scripts/taste-card-benchmark.ts <username> [trials]
// Emits aggregate results only. Run with no workers writing profiles in the copy.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { workCards } from '../src/lib/collection/query.server';
import { getDb, getSql, closeDb } from '../src/lib/server/db';
import { withRequestConfig } from '../src/lib/server/config';
import {tasteRevisionSql} from '../src/lib/social/taste-cache.server';
import {titleTastes} from './benchmarks/incumbent-taste';
import { sql as query } from 'drizzle-orm';

const username = process.argv[2], trials = Number(process.argv[3] ?? 21);
if (!username || !Number.isInteger(trials) || trials < 20 || trials > 100) throw new Error('Provide a username and 20–100 trials.');
const url = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/taste_card_benchmark')
  throw new Error('This benchmark requires an isolated local taste_card_benchmark database.');
const sql = getSql();
const marker = 'taste-card-benchmark-miss';
const arms = ['baseline', 'warm serial', 'warm parallel', 'mixed serial', 'mixed parallel', 'cold serial', 'cold parallel'] as const;
type Arm = typeof arms[number];
type Reading = { ms: number; tasteMs: number; bytes: number };
const percentile = (samples: number[], p: number) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * p) - 1];
const round = (n: number) => Math.round(n * 100) / 100;
let interrupted = false;
process.once('SIGINT', () => { interrupted = true; });
process.once('SIGTERM', () => { interrupted = true; });

async function benchmark() {
  const [db] = await sql`select current_database() as name`;
  assert.equal(db.name, 'taste_card_benchmark');
  const [account] = await getDb().execute<{ id: string; revision: string }>(query`
  select u.id,${tasteRevisionSql} as revision from users u where u.username=${username} and not u.disabled`);
  assert(account, 'Account not found.');
  const { id, revision } = account;
  const refs = await sql`select medium,revision,pg_column_size(scoring) as scoring_bytes
  from user_taste_profiles where user_id=${id} and medium in ('movie','show') order by medium`;
  assert.equal(refs.length, 2, 'Both movie and show profiles must have been refreshed in the copy.');
  assert(refs.every(r => r.revision === revision), 'Refresh this account in the current copy before measuring.');
  // Deterministically interleave warm movie and show candidates across both sizes.
  const cohort = await sql`with sampled as (select s.work_id, m.kind,
  row_number() over(partition by m.kind order by hashtextextended(s.work_id::text,601),s.work_id) as n
  from user_taste_scores s join media m on m.id=s.work_id
  where s.user_id=${id} and s.revision=${revision} and m.kind in ('movie','show'))
  select work_id,kind from sampled where n<=36 order by n,kind`;
  assert.equal(cohort.length, 72, 'Need 36 published scores in each medium.');
  const ids = cohort.map(r => r.work_id as string);
  const summaries = [];
  const updateCache = async (batch: string[], keep: string[]) => {
    const updated = await sql`update user_taste_scores set revision=case when work_id=any(${sql.array(keep, 'UUID')}::uuid[]) then ${revision} else ${marker} end
   where user_id=${id} and work_id=any(${sql.array(batch, 'UUID')}::uuid[]) and revision in (${revision},${marker}) returning work_id`;
    assert.equal(updated.length, batch.length, 'Cache rows changed during measurement.');
  };
  try {
    for (const size of [24, 72]) {
      const batch = ids.slice(0, size);
      const expected = await titleTastes(id, batch);
      assert.equal(expected.size, size, 'A cohort member could not be projected.');
      const scores = batch.map(work => expected.get(work)?.score ?? null);
      const observations = new Map<Arm, Reading[]>(arms.map(arm => [arm, []]));
      let state = 'warm';
      for (let cycle = -3; cycle < trials; cycle++) {
        const turn = cycle + 3, offset = turn % arms.length;
        const order = [...arms.slice(offset), ...arms.slice(0, offset)];
        if (turn % 2) order.reverse();
        for (const arm of order) {
          if (interrupted) throw new Error('Benchmark interrupted.');
          const [pool, mode] = arm.split(' ');
          if (arm !== 'baseline' && pool !== state) {
            const keep = pool === 'warm' ? batch : pool === 'mixed' ? batch.filter((_, i) => i % 4 < 2) : [];
            // Leave the score and payload untouched. A mismatched revision takes exactly the
            // published cold path, with no admin diagnostics or friend lookups.
            await updateCache(batch, keep);
            state = pool;
          }
          const t0 = performance.now();
          const result = await withRequestConfig(async () => {
            let scoresMs = 0;
            async function taste() {
              const start = performance.now();
              const result = await titleTastes(id, batch);
              scoresMs = performance.now() - start;
              return result;
            }
            const cards = () => workCards(id, id, batch);
            const [projected, matches] = arm === 'baseline' ? [await cards(), undefined] as const
              : mode === 'parallel' ? await Promise.all([cards(), taste()]) : [await cards(), await taste()] as const;
            const items = matches ? projected.map(card => {
              const match = matches.get(card.id);
              return match?.score != null ? { ...card, tasteScore: match.score } : card;
            }) : projected;
            const json = JSON.stringify({ items });
            const ms = performance.now() - t0;
            return { ms, tasteMs: scoresMs, bytes: Buffer.byteLength(json), matches, projected };
          });
          assert.deepEqual(result.projected.map(card => card.id), batch);
          if (result.matches) assert.deepEqual(batch.map(work => result.matches!.get(work)?.score ?? null), scores, 'Cold and warm percentages differ.');
          if (cycle >= 0) observations.get(arm)!.push({ ms: result.ms, tasteMs: result.tasteMs, bytes: result.bytes });
        }
        if (cycle >= 0 && (cycle + 1) % 7 === 0) console.error(`Completed ${cycle + 1}/${trials} samples for ${size} cards.`);
      }
      const base = observations.get('baseline')!;
      const results = arms.map(arm => {
        const runs = observations.get(arm)!;
        return {
          arm, medianMs: round(percentile(runs.map(r => r.ms), 0.5)), p95Ms: round(percentile(runs.map(r => r.ms), .95)),
          pairedMedianDeltaMs: round(percentile(runs.map((r, i) => r.ms - base[i].ms), .5)),
          tasteMedianMs: round(percentile(runs.map(r => r.tasteMs), .5)), bytes: percentile(runs.map(r => r.bytes), .5)
        };
      });
      summaries.push({ size, cohortHash: createHash('sha256').update(batch.join(',')).digest('hex'), scored: scores.filter(n => n !== null).length, results });
      await updateCache(batch, batch);
    }
  } finally { await updateCache(ids, ids); }
  console.log(JSON.stringify({ trials, warmups: 3, serverVersion: await sql`show server_version`.then(r => r[0].server_version), referenceBytes: refs.map(r => [r.medium, r.scoring_bytes]), summaries }, null, 2));
}

try { await benchmark(); } finally { await closeDb(); }
