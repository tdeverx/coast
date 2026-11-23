// Offline exact rebuild. Private JSONL begins with a source receipt and ends with a completion record.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {open, readFile} from 'node:fs/promises';
import type {TasteReplayDataset} from '../../../scripts/taste-replay';
import {scoreTasteV2, trainTasteV2, type TasteV2Catalogue, type TasteV2Features} from '../../../src/lib/social/taste-v2';

type Medium = 'movie' | 'show';
type Row = TasteReplayDataset['history'][number];
type Target = {id:string;stars:number;cluster:string;group:string;scores:{calibrated:number|null}};
type Panel = {medium:Medium;split:string;budget:string;targets:Target[]};
type Metadata = {id:string;title:string;credits?:{id:number;name:string;role:string}[]|null};
type Request = {target:string;donors:string[];extraExcluded?:string[]};
const [medium, capturePath, metadataPath, cataloguePath, gradedPath, output, mode, checkpoint] = Bun.argv.slice(2);
const requestsPath = mode === '--resume-from' ? undefined : mode;
assert(mode === '--resume-from' ? checkpoint : !checkpoint, 'Use --resume-from with the unfinished private ledger.');
if ((medium !== 'movie' && medium !== 'show') || !output)
  throw Error('Pass movie|show CAPTURE METADATA INDEPENDENT_CATALOGUE GRADED NEW_PRIVATE_JSONL [NAMED_DONOR_REQUESTS_JSON | --resume-from PARTIAL_JSONL].');
const hash = (data:string|Uint8Array) => createHash('sha256').update(data).digest('hex');
const receipt = JSON.parse(await readFile(gradedPath, 'utf8')) as {
  manifest: {capture:string;metadata:string;independentCatalogue:string;sources:Record<string,string>};runs:Panel[]
};
async function verified<T>(path:string, digest:string):Promise<T> {
  const buf = await readFile(path);
  assert.equal(hash(buf), digest, 'Input differs from original replay');
  return JSON.parse(buf.toString());
}
const [capture, metadata, catalogue] = await Promise.all([
  verified<TasteReplayDataset[]>(capturePath, receipt.manifest.capture),
  verified<Metadata[]>(metadataPath, receipt.manifest.metadata),
  verified<Record<Medium,TasteV2Catalogue>>(cataloguePath, receipt.manifest.independentCatalogue),
  Promise.all(Object.entries(receipt.manifest.sources).map(async ([path, digest]) => {
    assert.equal(hash(await readFile(path)), digest, 'Native implementation has changed since the original replay');
  }))
]);
const dataset = capture.find(d => d.medium === medium)!;
const supplied = new Map(metadata.map(m => [m.id,m]));
function features(id:string, ordinary:Row['features']):TasteV2Features {
  const credit = supplied.get(id)?.credits?.filter(c => c.role === 'Creator' && /^\d+$/.test(String(c.id)));
  return credit?.length ? {...ordinary, creators:credit.map(c => ({id:'tmdb:'+c.id, name:c.name}))} : ordinary;
}
// Mirrors the all-ratings mask. Worked-but-unrated records lose rating provenance; the
// complete personal root is then removed for each target, including aggregated episode actions.
const history = dataset.history.flatMap(r => {
  const w = r.work;
  const combined = {...r, features:features(w.id,r.features), audience:undefined};
  if (w.rating !== null) return [combined];
  if (!(w.implicit || w.explicit || w.chosen || w.consumed || w.repeated || w.dropped || w.deliberateReturn)) return [];
  return [{...combined,credits:undefined,work:{...w,lastRatedAt:null}}];
});
const descriptions = new Map(dataset.history.map(r => [r.work.id, features(r.work.id,r.features)]));
for (const r of dataset.catalogue) descriptions.set(r.id,features(r.id,r.features));
const original = receipt.runs.find(r => r.medium === medium && r.split === 'work' && r.budget === 'all')!;
const targets = new Map(original.targets.map(t => [t.id,t]));
assert.equal(new Set(history.map(r => r.work.id)).size,history.length);
assert.equal(history.filter(r => r.work.rating !== null).length, targets.size);
const pri = ['Farzar','Rick and Morty','President Curtis','Paradise PD','Little Demon','Community'];
function priority(id:string) {
  const i = pri.indexOf(supplied.get(id)?.title ?? '');
  return i < 0 ? pri.length : i;
}
const start = performance.now();
function model(exclude:(id:string) => boolean) {
  return trainTasteV2(medium as Medium,history.filter(r => !exclude(r.work.id)),
    {stage:'calibrated',asOf:dataset.asOf,catalogue:catalogue[medium as Medium]});
}
function score(m:ReturnType<typeof model>, id:string) {
  return scoreTasteV2(m,descriptions.get(id)!,{details:false}).score;
}
// Include unrated members of a donor's original franchise when hiding nested witnesses.
const parents = new Map<string,string>();
function family(key:string) {while(parents.has(key)) key=parents.get(key)!;return key;}
for (const r of dataset.history) {
  for (const key of [...(r.collections??[]).map(k=>'collection:'+k),...(r.features.franchises??[]).map(k=>'feature:'+k.id)]) {
    const roots = [family(r.work.id),family(key)].sort();
    if (roots[0] !== roots[1]) parents.set(roots[1],roots[0]);
  }
}
assert(original.targets.every(t => family(t.id) === t.cluster));
const outputFile = await open(output,'wx',0o600);
const emit = (value:object) => outputFile.writeFile(JSON.stringify(value)+'\n');
try {
  const firstFold = (id:string) => parseInt(hash(id).slice(0,2),16)%5 === 0;
  const reference = model(firstFold);
  const sanity = original.targets.filter(t => t.group === '0');
  assert(sanity.length && sanity.every(t => firstFold(t.id) && score(reference,t.id) === t.scores.calibrated),
    'Native controls do not reproduce the archived work-fold benchmark');
  const header = {type:'receipt',medium,targets:targets.size,matchedFrozenControls:sanity.length,
    gradedHash:hash(await readFile(gradedPath)),mode:requestsPath?'jointExclusion':'leaveOneTitleOut'};
  await emit(header);
  let completed = 0;
  if (requestsPath) {
    const requests = JSON.parse(await readFile(requestsPath,'utf8')) as Request[];
    for (const {target,donors,extraExcluded=[]} of requests) {
      assert(targets.has(target) && extraExcluded.every(i=>targets.has(i)));
      const removed = new Set([target,...extraExcluded]);
      const fitted = model(id => removed.has(id));
      const description = descriptions.get(target)!;
      const fit = scoreTasteV2(fitted,description);
      assert.equal(fit.score,score(fitted,target));
      const withoutCreators = scoreTasteV2(fitted,{...description,creators:[]},{details:false}).score;
      const ranked = fit.signals.map(({dimension,name,contribution}) => ({dimension,name,contribution}))
        .sort((a,b) => b.contribution-a.contribution);
      await emit({type:'named',medium,target,extraExcluded,score:fit.score,withoutCreators,
        positive:ranked.filter(r=>r.contribution>0).slice(0,5),
        negative:ranked.filter(r=>r.contribution<0).reverse().slice(0,5)});
      const groups = Map.groupBy(Array.from(new Set(donors)), id => family(id));
      for (const [group, members] of groups) {
        assert(members.every(id => targets.has(id) && !(removed.has(id))));
        const m = model(id => removed.has(id) || family(id) === group);
        for (const id of members) {
          await emit({type:'donor',medium,target,extraExcluded,id,score:score(m,id)});
          completed++;
        }
      }
    }
  } else {
    const ordered = Array.from(targets.keys()).sort((a,b) => priority(a)-priority(b) || a.localeCompare(b));
    if (checkpoint) {
      const saved = await readFile(checkpoint, 'utf8');
      // A write interrupted at the last line has no terminating newline. Refit that title.
      const [source,...records] = saved.slice(0,saved.lastIndexOf('\n')).split('\n');
      assert.deepEqual(JSON.parse(source),header,'Checkpoint belongs to another replay');
      for (const line of records) {
        const row = JSON.parse(line);
        assert(row.type === 'target' && row.medium === medium && row.id === ordered[completed],
          'Checkpoint contains an unexpected target or is already complete');
        assert(row.score === null || (Number.isInteger(row.score) && row.score >= 0 && row.score <= 100));
        await emit(row);
        completed++;
      }
      console.error(medium,'retained',completed,'verified target records');
    }
    for (const id of ordered.slice(completed)) {
      const prediction = score(model(other=>other===id),id);
      await emit({type:'target',medium,id,score:prediction});
      completed++;
      if (completed % 50 === 0) console.error(medium,completed,'of',ordered.length);
    }
  }
  await emit({type:'complete',medium,completed,elapsedSeconds:(performance.now()-start)/1000});
  await outputFile.sync();
} finally {await outputFile.close();}
