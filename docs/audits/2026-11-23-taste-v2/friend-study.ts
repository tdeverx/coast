// Private two-person forecast experiment. Commands and prerequisites are in social.md.
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {requireFeature} from '../../../src/lib/server/features';
import {workTasteFeatures} from '../../../src/lib/social/work-features.server';
import {closeDb} from '../../../src/lib/server/db';
import {snapshotFriendOutcomesV2} from '../../../src/lib/social/friend-taste-v2.server';
import type {PairedFriendForecastV2} from '../../../src/lib/social/friend-taste-v2';

type Medium='movie'|'show';
type SealedPeer={id:string;medium:Medium;personal:number;friendStars:number|null;genres:string[];franchise?:string};
type PairSeal={version:1;viewerId:string;friendId:string;modelHash:string;asOf:string;rows:SealedPeer[]};
type Outcome={id:string;medium:Medium;stars:number;at:string};
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const mode=Bun.argv[2];
const isId=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const isMedium=(value:unknown):value is Medium=>value==='movie'||value==='show';

if (mode==='seal') {
  const [consent,viewerId,friendId,ledgerPath,destination]=Bun.argv.slice(3);
  if (consent!=='--consented'||!isId(viewerId)||!isId(friendId)||viewerId===friendId||!destination)
    throw Error('Specify both consenting participants, the viewer’s frozen v2 ledger and a new private output file.');
  const url=new URL(process.env.DATABASE_URL??'');
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||process.env.NODE_ENV==='production')
    throw Error('Paired studies run on a local dev database.');
  const ledger=JSON.parse(await readFile(ledgerPath,'utf8'));
  const modelHash=hash(await readFile('src/lib/social/taste-v2.ts'));
  if (ledger.version!==2 || ledger.manifest?.sources?.['src/lib/social/taste-v2.ts']!==modelHash ||
    !(Date.parse(ledger.sealed)<=Date.now()) || !ledger.salt) throw Error('Use a matching, pre-existing v2 personal forecast ledger.');
  const forecasts=new Map<string,number>();
  for (const row of ledger.entries) if (isMedium(row.medium)&&Number.isFinite(row.v2)) forecasts.set(row.key,row.v2);
  try {
    const visible=await snapshotFriendOutcomesV2(viewerId,friendId);
    const asOf=new Date().toISOString();
    const rows:SealedPeer[]=[];
    const config=await requireFeature(viewerId,'personalisation');
    for(let i=0;i<visible.length;i+=128){
      const batch=visible.slice(i,i+128);
      const features=await workTasteFeatures(batch.map(item=>item.id),config.metadataSource);
      for (const item of batch) {
        const personal=forecasts.get(hash([ledger.salt,item.medium,item.id].join('/')));
        const facts=features.get(item.id);
        if (personal!==undefined) rows.push({id:item.id,medium:item.medium,personal,friendStars:item.stars,
          genres:facts?.genres?.map(genre=>genre.id)??[],franchise:facts?.franchises?.[0]?.id});
      }
    }
    await writeFile(destination,JSON.stringify({version:1,viewerId,friendId,modelHash,asOf,rows} satisfies PairSeal),{mode:0o600,flag:'wx'});
    console.log(JSON.stringify({asOf,pairedForecasts:rows.length}));
  } finally {await closeDb();}
} else if (mode==='label') {
  const [snapshot,ratingPath,destination]=Bun.argv.slice(3);
  if (!destination) throw Error('Specify a sealed friend study, verified original viewer ratings and a new private study file.');
  const pair:PairSeal=JSON.parse(await readFile(snapshot,'utf8'));
  if (pair.version!==1||!isId(pair.viewerId)||!isId(pair.friendId)||!Number.isFinite(Date.parse(pair.asOf)))
    throw Error('Invalid sealed friend study.');
  const outcomes:Outcome[]=JSON.parse(await readFile(ratingPath,'utf8'));
  const byWork=new Map<string,Outcome[]>();
  for(const outcome of outcomes) {
    if(!isMedium(outcome.medium)||!isId(outcome.id)||!(outcome.stars>=.5&&outcome.stars<=5))continue;
    const key=outcome.medium+'/'+outcome.id,entries=byWork.get(key)??[];
    entries.push(outcome);byWork.set(key,entries);
  }
  const studies=(['movie','show'] as const).map(medium=>{
    const forecasts:PairedFriendForecastV2[]=[];
    for(const row of pair.rows) {
      if(row.medium!==medium)continue;
      const outcomes=byWork.get(medium+'/'+row.id)??[];
      if(!outcomes.length||outcomes.some(o=>!(Date.parse(o.at)>Date.parse(pair.asOf))))continue;
      const date=Math.min(...outcomes.map(o=>Date.parse(o.at))),first=outcomes.filter(o=>Date.parse(o.at)===date);
      if(new Set(first.map(o=>o.stars)).size!==1)continue;
      forecasts.push({...row,viewerStars:first[0].stars,predictedAt:pair.asOf,friendObservedAt:pair.asOf,viewerRatedAt:first[0].at});
    }
    return {viewerId:pair.viewerId,friendId:pair.friendId,medium,forecasts};
  });
  await writeFile(destination,JSON.stringify({version:1,modelHash:pair.modelHash,studies}),{flag:'wx',mode:0o600});
  console.log(JSON.stringify(studies.map(s=>({medium:s.medium,pairedLabels:s.forecasts.length}))));
} else throw Error('Choose seal or label.');
