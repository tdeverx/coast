// Offline single-viewer ablation. Remove each family on the training and target sides together.
import { trainReplayReference, workFold, type TasteReplayDataset } from '../../../../scripts/taste-replay';
import { scorerFromReference, type TasteDimension, type TasteFeatures } from '../../../../src/lib/social/taste-profile';
import { writeFile } from 'node:fs/promises';

const [input, output] = Bun.argv.slice(2);
if (!input || !output) throw Error('Usage: bun families.ts <frozen-history.json> <private-output.json>');
const datasets: TasteReplayDataset[] = await Bun.file(input).json();
const arms: Record<string, TasteDimension[]> = {
  all: [], certification: ['ageRatings'], description: ['genres', 'tags', 'themes'],
  people: ['cast', 'directors', 'writers', 'composers', 'cinematographers'],
  studios: ['studios', 'networks'], eraRegion: ['decades', 'countries', 'languages'],
};
const results = [];
for (const [arm, blocked] of Object.entries(arms)) {
  const remove = (original: TasteFeatures): TasteFeatures => {
    const features = {...original};
    for (const dim of blocked) delete features[dim];
    return features;
  };
  for (const dataset of datasets) {
    const data = {...dataset,
      history: dataset.history.map(r => ({...r, audience:undefined, features:remove(r.features),
        credits:r.credits?.map(c => ({...c, features:remove(c.features)}))})),
      catalogue: dataset.catalogue.map(r => ({...r, features:remove(r.features)}))};
    const candidates = new Map(data.catalogue.map(r => [r.id,r.features]));
    for (const rated of [true,false]) {
      for (let fold=0; fold<5; fold++) {
        const train = data.history.filter(r => workFold(r.work.id)!==fold);
        const score = scorerFromReference(await trainReplayReference(data,train,rated));
        for (const r of data.history) {
          if (r.work.rating===null || workFold(r.work.id)!==fold) continue;
          const id=r.work.id;
          results.push({arm,rated,medium:data.medium,fold,id,stars:r.work.rating,
            score:score(candidates.get(id)??r.features).score});
        }
      }
    }
  }
}
await writeFile(output,JSON.stringify(results),{mode:0o600});
