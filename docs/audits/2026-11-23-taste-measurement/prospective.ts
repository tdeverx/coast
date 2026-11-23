// Private offline prediction ledger. Create before new feedback, evaluate after importing it.
// bun prospective.ts freeze <canonical-capture.json> <new-private-ledger.json>
// bun prospective.ts evaluate <private-ledger.json> <verified-direct-ratings.json>
import {createHash,randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {trainReplayReference,type TasteReplayDataset} from '../../../scripts/taste-replay';
import {scorerFromReference} from '../../../src/lib/social/taste-profile';

type Entry={key:string;medium:string;personal:number|null;actionsOnly:number|null;withoutSelection:number|null};
type Ledger={version:1;sealed:string;salt:string;inputHash:string;entries:Entry[]};
type Rating={id:string;medium:string;at:string;stars:number};
const [mode,left,right]=Bun.argv.slice(2);
if(!left||!right||!['freeze','evaluate'].includes(mode))throw Error('Expected freeze or evaluate and two local file paths.');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const key=(salt:string,medium:string,id:string)=>hash([salt,medium,id].join('/'));

if(mode==='freeze'){
  const raw=await Bun.file(left).text();
  const datasets:TasteReplayDataset[]=JSON.parse(raw);
  const ledger:Ledger={version:1,sealed:new Date().toISOString(),salt:randomBytes(32).toString('hex'),inputHash:hash(raw),entries:[]};
  for(const d of datasets){
    if(d.medium!=='movie' && d.medium!=='show')continue;
    const history=d.history.map(r=>({...r,audience:undefined}));
    const known=new Set(history.map(r=>r.work.id));
    const ref=await trainReplayReference(d,history,true);
    const personal=scorerFromReference(ref);
    const actions=scorerFromReference(await trainReplayReference(d,history.filter(r=>{
      const w=r.work;
      return !!(w.implicit||w.explicit||w.chosen||w.consumed||w.repeated||w.dropped||w.deliberateReturn);
    }),false));
    const withoutSelection=scorerFromReference({...ref,selection:undefined});
    for(const r of d.catalogue){
      if(r.observed||known.has(r.id))continue;
      ledger.entries.push({key:key(ledger.salt,d.medium,r.id),medium:d.medium,personal:personal(r.features).score,
        actionsOnly:actions(r.features).score,withoutSelection:withoutSelection(r.features).score});
    }
  }
  const unique=new Set(ledger.entries.map(r=>r.key));
  if(unique.size!==ledger.entries.length)throw Error('Duplicate catalogue identities.');
  await writeFile(right,JSON.stringify(ledger),{flag:'wx',mode:0o600});
  for(const m of ['movie','show']){
    const entries=ledger.entries.filter(r=>r.medium===m);
    console.log(JSON.stringify({medium:m,sealed:ledger.sealed,targets:entries.length,scoreable:entries.filter(r=>r.personal!==null).length}));
  }
}else{
  const ledger:Ledger=await Bun.file(left).json(), ratings:Rating[]=await Bun.file(right).json();
  if(ledger.version!==1 || !Number.isFinite(Date.parse(ledger.sealed)))throw Error('Unknown ledger format.');
  const actual=new Map<string,Rating>(), conflicts=new Set<string>();
  for(const r of ratings){
    if(!r.id||!Number.isFinite(r.stars)||r.stars<0||r.stars>5||!(Date.parse(r.at)>Date.parse(ledger.sealed)))continue;
    const k=key(ledger.salt,r.medium,r.id), previous=actual.get(k);
    if(previous && (previous.stars!==r.stars || previous.at!==r.at)){conflicts.add(k);continue;}
    actual.set(k,r);
  }
  for(const medium of ['movie','show']){
    const labelled=ledger.entries.filter(r=>r.medium===medium && !conflicts.has(r.key) && actual.has(r.key));
    const common=labelled.filter(r=>r.personal!==null && r.actionsOnly!==null && r.withoutSelection!==null);
    const stars=(r:Entry)=>actual.get(r.key)!.stars;
    for(const method of ['personal','actionsOnly','withoutSelection'] as const){
      let ordered=0,pairs=0;
      for(const a of common.filter(r=>stars(r)>=4))for(const b of common.filter(r=>stars(r)<=3)){
        pairs++;ordered+=Number(a[method]!>b[method]!)+.5*Number(a[method]===b[method]);
      }
      const green=labelled.filter(r=>r[method]!==null && r[method]!>=80);
      console.log(JSON.stringify({medium,method,labelled:labelled.length,coverage:labelled.filter(r=>r[method]!==null).length,
        common:common.length,pairs,ordering:pairs?ordered/pairs:null,green:green.length,
        greenThreeHalfPlus:green.filter(r=>stars(r)>=3.5).length,weakGreen:green.filter(r=>stars(r)<=3).length,
        fiveGreen:green.filter(r=>stars(r)===5).length,fiveTotal:labelled.filter(r=>stars(r)===5).length}));
    }
  }
}
