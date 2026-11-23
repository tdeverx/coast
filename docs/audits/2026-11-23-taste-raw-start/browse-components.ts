// Explain the score distribution on untouched catalogue titles without changing any display policy.
import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import type {TasteReplayDataset} from '../../../scripts/taste-replay';
import {scorerFromReference} from '../../../src/lib/social/taste-profile';
import {scoreTasteV2,trainTasteV2,type TasteV2Catalogue,type TasteV2Medium,type TasteV2Features} from '../../../src/lib/social/taste-v2';
import {orderedValue} from '../../../src/lib/social/taste-v2-ordinal';
import {creatorAugmenter,mask} from '../2026-11-23-taste-dislikes/breakdowns-ablation';

const [capturePath,metadataPath,cataloguePath,output]=Bun.argv.slice(2);
const captures:TasteReplayDataset[]=await Bun.file(capturePath).json();
const catalogue:Record<TasteV2Medium,TasteV2Catalogue>=await Bun.file(cataloguePath).json();
const augment=creatorAugmenter(await Bun.file(metadataPath).json());
const result=await open(output,'wx',0o600);
try {
  for(const medium of ['movie','show'] as const) {
    const data=captures.find(r=>r.medium===medium)!;
    const history=mask(data.history.map(r=>({...r,features:augment(r.work.id,r.features)})),'all');
    const profile=trainTasteV2(medium,history,{stage:'calibrated',catalogue:catalogue[medium],asOf:data.asOf});
    const before={...profile,display:undefined};
    const personal={...profile,stage:'personal' as const};
    const signed=scorerFromReference(profile.signed!);
    const known=new Set(history.map(r=>r.work.id));
    const dimensions=['tags','genres','cast','creators','directors','writers','franchises','studios','networks'] as const;
    const toScore=(f:TasteV2Features)=>scoreTasteV2(profile,f,{details:false}).score;
    const coefficient=Object.entries(profile.ordinal?.coefficients??{});
    await result.writeFile(JSON.stringify({type:'profile',medium,works:profile.works,ratings:profile.ratings,display:profile.display,
      ordinalBase:profile.ordinal?orderedValue(profile.ordinal,0):null,ordinalTerms:coefficient.length})+'\n');
    let count=0;
    for(const r of data.catalogue) {
      if(r.observed || known.has(r.id))continue;
      const f=augment(r.id,r.features);
      const p=scoreTasteV2(personal,f,{details:false}).score;
      const s=signed(f).score;
      const raw=scoreTasteV2(before,f,{details:false}).score;
      if(p!==null && s!==null && raw!==null)assert.equal(raw,Math.round((p+s)/2));
      const counts=Object.fromEntries(dimensions.map(k=>[k,f[k]?.length??0]));
      const native=toScore(f);
      const withoutGenre=f.genres?.length ? toScore({...f,genres:[]}) : native;
      const withoutSpecific=toScore({...f,tags:[],franchises:[],cast:[],directors:[],writers:[],creators:[],studios:[],networks:[]});
      await result.writeFile(JSON.stringify({type:'target',id:r.id,medium,p,s,raw,native,withoutGenre,withoutSpecific,counts})+'\n');
      count++;
    }
    console.log(medium,count,'untouched catalogue projections');
  }
} finally {await result.close();}
