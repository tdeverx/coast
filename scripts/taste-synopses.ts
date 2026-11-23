// Import requires locally encoded, content-addressed vectors. Serving never calls an encoder.
import { open } from 'node:fs/promises';
import * as v from 'valibot';
import { getSql, closeDb } from '../src/lib/server/db';
import { resolvedTasteSynopsis, tasteSynopsisModel } from '../src/lib/social/taste-synopsis.server';

const vector = v.object({
  id: v.pipe(v.string(), v.uuid()), model: v.literal(tasteSynopsisModel),
  hash: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/)),
  embedding: v.pipe(v.array(v.pipe(v.number(), v.finite())), v.length(384),
    v.check(values => Math.abs(values.reduce((sum, value) => sum + value * value, 0) - 1) <= 0.005)),
});

async function importVectors(filename: string) {
  const sql = getSql();
  let count = 0, processed = 0;
  await sql.begin(async tx => {
    let batch: v.InferOutput<typeof vector>[] = [];
    async function flush() {
      if (!batch.length) return;
      const saved = await tx`insert into work_taste_synopses (work_id, model, synopsis_sha256, embedding)
        select id, model, hash, embedding from jsonb_to_recordset(${JSON.stringify(batch)}::text::jsonb)
          as x(id uuid, model text, hash text, embedding real[])
        on conflict (work_id) do update set model=excluded.model, synopsis_sha256=excluded.synopsis_sha256,
          embedding=excluded.embedding
        where (work_taste_synopses.model,work_taste_synopses.synopsis_sha256)
          is distinct from (excluded.model,excluded.synopsis_sha256)
        returning work_id`;
      count += saved.length;
      batch = [];
    }
    async function append(line: string) {
      if (!line.trim()) return;
      batch.push(v.parse(vector, JSON.parse(line)));
      processed++;
      if (batch.length === 64) await flush();
    }
    // Pull the next chunk only after processing the current one, including SQL backpressure.
    const input = Bun.file(filename).stream().pipeThrough(new TextDecoderStream()).getReader();
    let partial = '';
    try {
      for (;;) {
        const {done, value} = await input.read();
        if (done) break;
        const lines = (partial + value).split('\n');
        partial = lines.pop()!;
        for (const line of lines) await append(line);
      }
      await append(partial);
    } finally { await input.cancel(); }
    await flush();
  });
  console.info(`Read ${processed} records and imported ${count} new or changed synopsis vectors.`);
}

async function exportSynopses(filename: string) {
  const sql = getSql();
  const output = await open(filename, 'wx', 0o600);
  let cursor: string | null = null;
  try {
    for (;;) {
      const rows: {id:string;overview:string|null; current_hash:string|null}[] = await sql`
        select w.id, ${resolvedTasteSynopsis(sql)} as overview, vec.synopsis_sha256 as current_hash
        from works w join media m on m.id=w.id
        left join metadata_overrides art on art.media_id=w.id
        left join lateral (select s.overview from metadata_snapshots s where s.media_id=w.id and s.provider='tmdb'
          order by (s.language='en') desc,s.updated_at desc,s.id limit 1) snap on true
        left join work_taste_synopses vec on vec.work_id=w.id and vec.model=${tasteSynopsisModel}
        where w.kind in ('movie','show') ${cursor ? sql`and w.id > ${cursor}::uuid` : sql``}
        order by w.id limit 256`;
      if (!rows.length) break;
      let page = '';
      for (const {id,overview,current_hash} of rows) {
        if (!overview) continue;
        const hash = new Bun.CryptoHasher('sha256').update(overview).digest('hex');
        if (hash !== current_hash) page += JSON.stringify({id,overview,hash})+'\n';
      }
      if (page) await output.writeFile(page);
      cursor = rows[rows.length - 1].id;
    }
  } finally { await output.close(); }
}
const [action, filename] = process.argv.slice(2);
try {
  if (action === 'export' && filename) await exportSynopses(filename);
  else if (action === 'import' && filename) await importVectors(filename);
  else throw new Error('Usage: bun scripts/taste-synopses.ts <export|import> <file.ndjson>');
} finally { await closeDb(); }
