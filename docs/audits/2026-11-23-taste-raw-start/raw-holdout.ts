// Offline only. Rebuild one personal profile per directly rated title and check its
// baseline against the frozen single-title ledger before testing the archived changes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {open, readFile} from 'node:fs/promises';
import type {TasteReplayDataset} from '../../../scripts/taste-replay';
import {scoreTasteV2, trainTasteV2, type TasteV2Catalogue} from '../../../src/lib/social/taste-v2';
import {buildScorers, creatorAugmenter, mask} from '../2026-11-23-taste-dislikes/breakdowns-ablation';

const [medium,capturePath,creditsPath,cataloguePath,gradedPath,nativePath,verifiedPath,outputPath] = Bun.argv.slice(2);
assert((medium === 'movie' || medium === 'show') && outputPath,
  'Pass movie|show CAPTURE CREDITS INDEPENDENT_CATALOGUE GRADED NATIVE_JSONL VERIFIED NEW_PRIVATE_JSONL.');

const hash = (data:Buffer) => createHash('sha256').update(data).digest('hex');
const gradedBytes = await readFile(gradedPath);
const {manifest} = JSON.parse(gradedBytes.toString());
async function verified<T>(path:string, expected:string):Promise<T> {
  const bytes = await readFile(path);
  assert.equal(hash(bytes), expected, 'Frozen input no longer matches');
  return JSON.parse(bytes.toString());
}
type CreditRow = Parameters<typeof creatorAugmenter>[0][number] & {title:string};
type Label = {id:string; medium:string; stars:number; at:string};
const [captures, credits, catalogue, verifiedBytes, ledger] = await Promise.all([
  verified<TasteReplayDataset[]>(capturePath, manifest.capture),
  verified<CreditRow[]>(creditsPath, manifest.metadata),
  verified<Record<typeof medium,TasteV2Catalogue>>(cataloguePath, manifest.independentCatalogue),
  readFile(verifiedPath), readFile(nativePath, 'utf8'),
  Promise.all(Object.entries(manifest.sources).map(async ([path,digest]) => {
    assert.equal(hash(await readFile(path)), digest, 'Native implementation has changed');
  }))
]);

const records = ledger.trimEnd().split('\n').map(line => JSON.parse(line));
const [receipt] = records, footer = records.at(-1);
assert(receipt.type === 'receipt' && receipt.medium === medium && receipt.mode === 'leaveOneTitleOut');
assert.equal(receipt.gradedHash, hash(gradedBytes));
assert(footer.type === 'complete' && footer.medium === medium && footer.completed === receipt.targets);
const expected = new Map<string,number|null>(records.slice(1,-1).map(r => {
  assert(r.type === 'target' && r.medium === medium);
  return [r.id,r.score];
}));
assert.equal(expected.size, footer.completed);
const data = captures.find(d => d.medium === medium)!;
const augment = creatorAugmenter(credits);
const history = mask(data.history.map(r => ({...r,features:augment(r.work.id,r.features)})), 'all');
const descriptions = new Map(history.map(r => [r.work.id,r.features]));
for (const r of data.catalogue) descriptions.set(r.id,augment(r.id,r.features));
const ratings = new Map(history.map(r => [r.work.id,r.work.rating]));
const titles = new Map(credits.map(r => [r.id,r.title]));
const direct = (JSON.parse(verifiedBytes.toString()).ratings as Label[]).filter(r => r.medium === medium);
assert.equal(direct.length, medium === 'movie' ? 444 : 426);
assert.equal(new Set(direct.map(r => r.id)).size, direct.length);
const out = await open(outputPath, 'wx', 0o600);
const emit = (value:object) => out.writeFile(JSON.stringify(value)+'\n');
try {
  await emit({type:'receipt',medium,n:direct.length,gradedHash:receipt.gradedHash,labelHash:hash(verifiedBytes)});
  for (const r of direct) {
    assert(r.at && r.stars === ratings.get(r.id) && expected.has(r.id));
    const fit = trainTasteV2(medium, history.filter(other => other.work.id !== r.id),
      {stage:'calibrated',asOf:data.asOf,catalogue:catalogue[medium]});
    const score = buildScorers(fit), features = descriptions.get(r.id)!;
    const scores = score(features,expected.get(r.id)!);
    const title = titles.get(r.id);
    if (title === 'Farzar') {
      const reduced = {...features,genres:features.genres?.filter(t => t.name !== 'Sci-Fi & Fantasy'),
        tags:features.tags?.filter(t => t.name.toLowerCase() !== 'space'),
        cast:features.cast?.filter(t => t.name !== 'Kari Wahlgren')};
      await emit({id:r.id,stars:r.stars,title,scores,
        stripped:score(reduced,scoreTasteV2(fit,reduced,{details:false}).score)});
    } else {
      await emit({id:r.id,stars:r.stars,title,scores});
    }
  }
  await emit({type:'complete',medium,n:direct.length});
  await out.sync();
} finally { await out.close(); }
