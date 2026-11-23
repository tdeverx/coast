// Read-only research. bun public-replay.ts ml-100k.zip result.json [alternate-trainer.ts|-] [time-fraction]
// Only anonymous movie IDs, genres, release years, ratings and timestamps are read.
import { namedFeatures, scorerFromReference, type TasteFeatures } from '../../../src/lib/social/taste-profile';
import { trainTasteMedium } from '../../../src/lib/social/taste-training';
import { resolve } from 'node:path';
import { neighborhood } from './public-neighbors';
const [archive, output, alternatePath, fractionArg='0.8'] = Bun.argv.slice(2);
const fraction=Number(fractionArg);
if (!archive || !output) throw Error('Supply the MovieLens 100K archive and a local result path.');
if (!(fraction>0 && fraction<1)) throw Error('Expected a time fraction between zero and one.');
function lines(member:string, encoding='utf-8') {
  const result = Bun.spawnSync(['unzip','-p',archive,'ml-100k/'+member]);
  if (result.exitCode) throw Error('Could not open '+member);
  return new TextDecoder(encoding).decode(result.stdout).trim().split(/\r?\n/);
}
const genres = lines('u.genre').map(row=>row.split('|')[0]);
const features = new Map<number,TasteFeatures>();
for (const line of lines('u.item','windows-1252')) {
  const [id,,released,,,...flags] = line.split('|');
  const names = genres.filter((name,i)=>name!=='unknown' && flags[i]==='1');
  const year = Number(released.slice(-4));
  features.set(+id,{genres:namedFeatures(names),...(year?{decades:namedFeatures([Math.floor(year/10)*10+'s'])}:{})});
}
const rows = lines('u.data').map(row=>row.trim().split(/\s+/).map(Number)).sort((a,b)=>a[3]-b[3]);
const endFraction=Number(Bun.argv[6]??1);
if(!(endFraction>fraction && endFraction<=1))throw Error('The end fraction must follow the training cutoff.');
const end=endFraction===1?Infinity:rows[Math.floor(rows.length*endFraction)][3];
const cutoff = rows[Math.floor(rows.length*fraction)][3], before = rows.filter(r=>r[3]<cutoff), after=rows.filter(r=>r[3]>=cutoff && r[3]<end);
const scorePeers=neighborhood(before,Math.max(...features.keys()));
const train = new Map<number,Map<number,number>>(), test = new Map<number,number[][]>();
const item = new Map<number,{n:number;likes:number}>();
for (const [u,id,stars] of before) {
  const profile = train.get(u) ?? new Map(); train.set(u, profile); profile.set(id,stars);
  const count = item.get(id) ?? {n:0,likes:0}; item.set(id,count); count.n++; count.likes+=Number(stars>=4);
}
for (const [u,id,y] of after) {const targets=test.get(u)??[];test.set(u,targets);targets.push([id,y]);}
const trainers = [trainTasteMedium];
if (alternatePath && alternatePath!=='-') trainers.push((await import(resolve(alternatePath))).trainTasteMedium);
const globalLike=(before.filter(r=>r[2]>=4).length+1)/(before.length+2);
const out = [];
for (const [u,targets] of test) {
  const profile=train.get(u);
  if (!profile || profile.size<10) continue;
  const fits=trainers.map(fit=>fit('movie',profile.size,null,cutoff*1000));
  const likes=[...profile.values()].filter(s=>s>=4).length;
  for (const [id,rating] of profile) {
    for(const fit of fits) fit.add({work:{id:String(id),kind:'movie',medium:'movie',rating,explicit:0,implicit:0,chosen:false,
      dropped:false,repeated:false,consumed:false},features:features.get(id)!});
  }
  const models=await Promise.all(fits.map(async fit=>scorerFromReference((await fit.finish()).reference)));
  for (const [id,y] of targets) {
    // The user has never rated this title in training. The community estimate uses earlier labels only.
    if(profile.has(id)) throw Error('Repeated rating crossed the time boundary.');
    const p=(likes+1)/(profile.size+2);
    const base=globalLike;const count=item.get(id)??{n:0,likes:0};
    const community=(count.likes+15*base)/(count.n+15);
    const shift=Math.log(community/(1-community))-Math.log(base/(1-base));
    const combined=1/(1+Math.exp(-Math.log(p/(1-p))-shift));
    const scores=models.map(fit=>fit(features.get(id)!).score);
    out.push({u,id,y,prior:p*100,community:community*100,personalCommunity:combined*100,...scorePeers(u,id),seen:profile.size,scores});
  }
}
function summary(){return {cutoff,before:before.length,after:after.length,people:test.size,predictions:out};}
await Bun.write(output,JSON.stringify(summary()));
