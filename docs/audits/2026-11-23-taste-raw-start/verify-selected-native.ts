import assert from 'node:assert/strict';
import {scoreTasteV2,trainTasteV2,selectedLowerScore,type TasteV2Features} from '../../../src/lib/social/taste-v2';
import type {TasteReplayDataset} from '../../../scripts/taste-replay';
import {creatorAugmenter,mask} from '../2026-11-23-taste-dislikes/breakdowns-ablation';

const [source,history,metadata,catalogue]=await Promise.all(Bun.argv.slice(2).map(p=>Bun.file(p).json()));
const augment=creatorAugmenter(metadata);
type Case={id:string;medium:string;known:boolean;features:TasteV2Features;native:number|null;bothRemovals:number|null};
for(const set of history as TasteReplayDataset[]) {
  const medium=set.medium;
  if(medium!=='movie' && medium!=='show') continue;
  const observations=mask(set.history.map(r=>({...r,features:augment(r.work.id,r.features)})),'all');
  const model=trainTasteV2(medium,observations,{stage:'calibrated',asOf:set.asOf,catalogue:catalogue[medium]});
  let scored=0;
  for(const row of source.rows as Case[]) {
    if(row.medium!==medium || row.known) continue;
    const match=scoreTasteV2(model,row.features,{details:false});
    assert.equal(match.score,row.native,row.id);
    if(match.score!==null) {
      assert.equal(selectedLowerScore(model,row.features),row.bothRemovals,row.id);
      scored++;
    }
  }
  console.log({medium,scored});
}
