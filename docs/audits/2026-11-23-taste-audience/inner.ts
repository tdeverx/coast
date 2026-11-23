// Generate honest personal-score residuals inside each frozen outer fold.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { TasteReplayDataset } from '../../../scripts/taste-replay';
import { trainTasteV2, scoreTasteV2, type TasteV2Catalogue, type TasteV2Medium } from '../../../src/lib/social/taste-v2';

type Row = TasteReplayDataset['history'][number];
type Dated = { id: string; at: string; stars: number; medium: TasteV2Medium };
type Target = { id: string; stars: number; group: string; scores: { calibrated: number | null } };
type Run = { medium: TasteV2Medium; split: string; budget: string; targets: Target[] };
type Point = { id: string; base: number };
type Metadata = { id: string; credits?: { id: number; name: string; role: string }[] | null };
const [capturePath, datePath, metadataPath, cataloguePath, gradedPath, output, extra] = Bun.argv.slice(2);
if (!output) throw Error('Pass frozen capture, dates, metadata, catalogue, graded replay, new private output.');
if (extra && extra !== '--include-sparse') throw Error('Unknown inner replay option.');
const receipt: { manifest: Record<string, string>; runs: Run[] } = await Bun.file(gradedPath).json();
const hash = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
async function checked<T>(path: string, key: string): Promise<T> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  assert.equal(hash(bytes), receipt.manifest[key]);
  return JSON.parse(new TextDecoder().decode(bytes));
}
const [capture, dates, metadata, catalogue] = await Promise.all([
  checked<TasteReplayDataset[]>(capturePath, 'capture'), checked<Dated[]>(datePath, 'dates'),
  checked<Metadata[]>(metadataPath, 'metadata'), checked<Record<TasteV2Medium, TasteV2Catalogue>>(cataloguePath, 'independentCatalogue')
]);
const creators = new Map(metadata.map(m => [m.id, (m.credits ?? []).filter(c => c.role === 'Creator' && /^\d+$/.test(String(c.id))).map(c => ({ id: 'tmdb:' + c.id, name: c.name }))]));
const outputRows: { medium: string; split: string; budget: string; group: string; points: Point[] }[] = [];
for (const data of capture) {
  if (data.medium !== 'show' && data.medium !== 'movie') continue;
  const medium = data.medium;
  const runs = receipt.runs.filter(r => r.medium === medium);
  const verified = new Map(dates.filter(d => d.medium === medium).map(d => [d.id, d]));
  const families = new Map<string, string>();
  const root = (k: string) => { while (families.has(k)) k = families.get(k)!; return k; };
  for (const r of data.history) {
    for (const k of [...(r.collections ?? []).map(s => 'collection:' + s), ...(r.features.franchises ?? []).map(s => 'feature:' + s.id)]) {
      const [a, b] = [root(r.work.id), root(k)].sort();
      if (a !== b) families.set(b, a);
    }
  }
  const historicalFeatures = new Map(data.history.map(r => [r.work.id, r.features]));
  const presentationFeatures = new Map(historicalFeatures);
  for (const r of data.catalogue) presentationFeatures.set(r.id, r.features);
  function augment(id: string, f: Row['features']) {
    const cast = creators.get(id);
    return cast?.length ? { ...f, creators: cast } : f;
  }
  const inner = (id: string) => parseInt(hash('audience-residual-family:' + root(id)).slice(0, 8), 16) % 3;
  const workFold = (s: string) => parseInt(hash(s).slice(0, 2), 16) % 5;
  function fit(rows: Row[], asOf: number, dated: boolean) {
    const outputs: Point[] = [];
    for (let k = 0; k < 3; k++) {
      const kept = rows.filter(r => inner(r.work.id) !== k);
      const model = trainTasteV2(medium as TasteV2Medium, kept, { stage: 'calibrated', asOf, catalogue: dated ? undefined : catalogue[medium] });
      for (const r of rows) {
        const id = r.work.id;
        if (inner(id) !== k || r.work.rating === null || !verified.has(id)) continue;
        const score = scoreTasteV2(model, augment(id, presentationFeatures.get(id)!), { details: false }).score;
        if (score !== null) outputs.push({ id, base: score });
      }
    }
    return outputs;
  }
  for (const run of runs) {
    const { split, budget } = run;
    const groups = [...new Set(run.targets.map(t => t.group))].sort();
    // Later-day scoring can reuse previous published, honestly forward predictions.
    // The initial import batch precedes the first scoreable day, so cross-fit its
    // already-known ratings once. Never train on the current day or later ratings.
    let first: Point[] = [];
    if (split === 'rolling-day') {
      const start = groups[0];
      const rows: Row[] = [...verified.values()].filter(d => d.at.slice(0, 10) < start && historicalFeatures.has(d.id)).map(d => ({
        work: { id: d.id, medium, kind: medium, rating: d.stars, lastRatedAt: d.at, explicit: 0, implicit: 0, consumed: false, repeated: false, chosen: false },
        features: augment(d.id, presentationFeatures.get(d.id)!)
      }));
      first = fit(rows, Date.parse(start + 'T00:00:00Z') - 1, true);
    }
    for (const group of groups) {
      let points: Point[] = [];
      if (split === 'rolling-day') {
        points = [...first, ...run.targets.filter(t => t.group < group && t.scores.calibrated !== null).map(t => ({ id: t.id, base: t.scores.calibrated! }))];
      } else if (budget === 'all' || parseInt(budget) >= (extra === '--include-sparse' ? 1 : 16)) {
        const assign = (id: string) => String(workFold(split === 'work' ? id : split === 'franchise' ? root(id) : 'coast-ordinal-eval-v1:' + root(id)));
        assert(run.targets.every(t => assign(t.id) === t.group));
        const prior = data.history.filter(r => assign(r.work.id) !== group);
        const [n, seed = '1'] = budget.split('#');
        const rated = prior.filter(r => r.work.rating !== null).map(r => r.work.id);
        const observed = new Set(budget === 'all' ? rated : rated.sort((a, b) => hash('solo:' + seed + ':' + a).localeCompare(hash('solo:' + seed + ':' + b))).slice(0, Number(n)));
        const rows = prior.flatMap(r => {
          const w = r.work;
          const features = augment(w.id, r.features);
          if (observed.has(w.id)) return [{ ...r, audience: undefined, features }];
          if (!(w.implicit || w.explicit || w.chosen || w.consumed || w.repeated || w.dropped || w.deliberateReturn)) return [];
          return [{ ...r, audience: undefined, credits: undefined, features, work: { ...w, rating: null, lastRatedAt: null } }];
        });
        points = fit(rows, data.asOf, false);
      }
      const held = new Set(run.targets.filter(t => t.group === group).map(t => t.id));
      assert(points.every(p => !held.has(p.id)));
      assert.equal(new Set(points.map(p => p.id)).size, points.length);
      outputRows.push({ medium, split, budget, group, points });
    }
    console.error(medium, split, budget, groups.length);
  }
}
await writeFile(output, JSON.stringify(outputRows), { flag: 'wx', mode: 0o600 });
