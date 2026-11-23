// Refit selected direct-rating holdouts and inspect the frozen score with individual inputs withheld.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {open, readFile} from 'node:fs/promises';
import type {TasteReplayDataset} from '../../../scripts/taste-replay';
import {scorerFromReference} from '../../../src/lib/social/taste-profile';
import {scoreTasteV2, trainTasteV2, type TasteV2Catalogue, type TasteV2Features,
  type TasteV2Medium} from '../../../src/lib/social/taste-v2';
import {creatorAugmenter, mask} from '../2026-11-23-taste-dislikes/breakdowns-ablation';

type Rating = {id:string; medium:TasteV2Medium; stars:number; title:string; native:number};
type Credit = Parameters<typeof creatorAugmenter>[0][number];
const [capture, metadata, catalogue, graded, team, ids, output] = Bun.argv.slice(2);
assert(output, 'Pass CAPTURE METADATA INDEPENDENT_CATALOGUE GRADED TEAM TARGET_ID_JSON NEW_PRIVATE_OUTPUT.');
const {manifest} = JSON.parse(await readFile(graded, 'utf8'));
async function verified(path:string, digest:string) {
  const bytes = await readFile(path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, path);
  return bytes;
}
for (const [path, digest] of Object.entries(manifest.sources)) await verified(path, String(digest));
const captures:TasteReplayDataset[] = JSON.parse((await verified(capture,manifest.capture)).toString());
const credits:Credit[] = JSON.parse((await verified(metadata,manifest.metadata)).toString());
const independent:Record<TasteV2Medium,TasteV2Catalogue> = JSON.parse((await verified(catalogue,manifest.independentCatalogue)).toString());
const ratings:Rating[] = JSON.parse(await readFile(team,'utf8'));
const selected = new Set<string>(JSON.parse(await readFile(ids,'utf8')));
assert.equal(ratings.length,870);
assert(selected.size && ratings.filter(r=>selected.has(r.id)).length===selected.size);
const augment = creatorAugmenter(credits);
const out = await open(output,'wx',0o600);
try {
  for (const medium of ['movie','show'] as const) {
    const data = captures.find(x=>x.medium===medium)!;
    const history = mask(data.history.map(r=>({...r,features:augment(r.work.id,r.features)})),'all');
    const descriptions = new Map(history.map(r=>[r.work.id,r.features]));
    for (const r of data.catalogue) descriptions.set(r.id,augment(r.id,r.features));
    for (const target of ratings.filter(r=>r.medium===medium && selected.has(r.id))) {
      const train=history.filter(r=>r.work.id!==target.id);
      assert.equal(train.length,history.length-1);
      const profile=trainTasteV2(medium,train,{asOf:data.asOf,stage:'calibrated',catalogue:independent[medium]});
      const features=descriptions.get(target.id)!;
      const result=scoreTasteV2(profile,features);
      assert.equal(result.score,target.native);
      const predict=(f:TasteV2Features)=>scoreTasteV2(profile,f,{details:false}).score;
      assert.equal(predict(features),target.native);
      const deltas=[];
      const families=[];
      for (const dimension of profile.dimensions) {
        const items=features[dimension]??[];
        if(!items.length) continue;
        const familyScore=predict({...features,[dimension]:[]});
        families.push({dimension,count:items.length,scoreWithout:familyScore});
        for(const t of items) {
          const score=predict({...features,[dimension]:items.filter(other=>other.id!==t.id)});
          if(score!==target.native) deltas.push({dimension,id:t.id,name:t.name,scoreWithout:score});
        }
      }
      const personal=scoreTasteV2({...profile,stage:'personal'},features,{details:false}).score;
      const signed=profile.signed?scorerFromReference(profile.signed,true)(features):null;
      const beforeDisplay=scoreTasteV2({...profile,display:undefined},features,{details:false}).score;
      await out.writeFile(JSON.stringify({id:target.id,title:target.title,medium,stars:target.stars,score:result.score,
        personal,signed:signed?.score,beforeDisplay,confidence:result.confidence,signalBase:result.base,
        signals:result.signals.map(s=>({dimension:s.dimension,id:s.id,name:s.name,points:s.contribution,
          rated:s.rated,works:s.works})),families,deltas})+'\n');
    }
  }
  await out.sync();
} finally {
  await out.close();
}
