// Reproduce the exact single-title holdout, retaining both sides of its fitted display mapping.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {open, readFile} from 'node:fs/promises';
import type {TasteReplayDataset} from '../../../scripts/taste-replay';
import {scoreTasteV2, trainTasteV2, type TasteV2Catalogue, type TasteV2Medium} from '../../../src/lib/social/taste-v2';
import {applyTasteV2Display} from '../../../src/lib/social/taste-v2-display';
import {creatorAugmenter, mask} from '../2026-11-23-taste-dislikes/breakdowns-ablation';

const [medium, capturePath, metadataPath, cataloguePath, gradedPath, directPath, nativePath, output] = Bun.argv.slice(2);
assert((medium === 'movie' || medium === 'show') && output,
  'Pass movie|show CAPTURE METADATA CATALOGUE GRADED DIRECT_RATINGS NATIVE_LEDGER NEW_PRIVATE_OUTPUT.');
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const gradedBytes = await readFile(gradedPath);
const {manifest} = JSON.parse(gradedBytes.toString());
async function verified(path: string, digest: string) {
  const bytes = await readFile(path);
  assert.equal(hash(bytes), digest, path);
  return bytes;
}
for (const [path, digest] of Object.entries(manifest.sources)) await verified(path, String(digest));
const captures: TasteReplayDataset[] = JSON.parse((await verified(capturePath, manifest.capture)).toString());
const metadata: Parameters<typeof creatorAugmenter>[0] = JSON.parse((await verified(metadataPath, manifest.metadata)).toString());
const catalogue: Record<TasteV2Medium, TasteV2Catalogue> = JSON.parse((await verified(cataloguePath, manifest.independentCatalogue)).toString());
const directBytes = await readFile(directPath);
type Rating = {id: string; medium: string; stars: number};
const ratings = (JSON.parse(directBytes.toString()).ratings as Rating[]).filter(r => r.medium === medium);
const nativeBytes = await readFile(nativePath);
const [receipt, ...records] = nativeBytes.toString().trimEnd().split('\n').map(line => JSON.parse(line));
const end = records.pop();
assert(receipt.mode === 'leaveOneTitleOut' && receipt.medium === medium && receipt.gradedHash === hash(gradedBytes));
assert(end.type === 'complete' && end.completed === records.length && end.medium === medium);
const expected = new Map<string, number>(records.map(r => {
  assert(r.type === 'target' && r.medium === medium);
  return [r.id, r.score];
}));
assert(expected.size === records.length && ratings.length === (medium === 'movie' ? 444 : 426));
assert.equal(new Set(ratings.map(r => r.id)).size, ratings.length);
const data = captures.find(p => p.medium === medium)!;
const augment = creatorAugmenter(metadata);
const history = mask(data.history.map(r => ({...r, features: augment(r.work.id, r.features)})), 'all');
const stars = new Map(history.map(r => [r.work.id, r.work.rating]));
const features = new Map(history.map(r => [r.work.id, r.features]));
for (const r of data.catalogue) features.set(r.id, augment(r.id, r.features));
const out = await open(output, 'wx', 0o600);
const emit = (r: object) => out.writeFile(JSON.stringify(r) + '\n');
try {
  await emit({type: 'receipt', split: 'full', medium, gradedHash: hash(gradedBytes), nativeHash: hash(nativeBytes),
    directHash: hash(directBytes), count: ratings.length});
  for (const r of ratings) {
    assert(stars.get(r.id) === r.stars && expected.has(r.id));
    const train = history.filter(row => row.work.id !== r.id);
    assert.equal(train.length, history.length - 1);
    const profile = trainTasteV2(medium, train, {stage: 'calibrated', catalogue: catalogue[medium], asOf: data.asOf});
    const target = features.get(r.id)!;
    const native = scoreTasteV2(profile, target, {details: false}).score;
    assert.equal(native, expected.get(r.id), r.id);
    const raw = scoreTasteV2({...profile, display: undefined}, target, {details: false}).score;
    assert(raw !== null);
    const projected = applyTasteV2Display(profile.display, raw);
    assert.equal(Math.round(projected), native, r.id);
    await emit({type: 'prediction', split: 'full', id: r.id, medium, stars: r.stars, raw, native, projected});
  }
  await emit({type: 'complete', split: 'full', medium, count: ratings.length});
  await out.sync();
} finally {
  await out.close();
}
