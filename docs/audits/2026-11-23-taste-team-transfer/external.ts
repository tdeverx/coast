import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {trainTasteV2, scoreTasteV2, type TasteV2Features,type TasteV2Observation} from '../../../src/lib/social/taste-v2';

type Rating = [number,string,number];
type Movie = {features:TasteV2Features;family:string;crew:string[]};
type Person = {id:string;cutoff:number;train:Rating[];held:Rating[];donors:Record<string,Record<string,string[]>>};
type Input = {movies:Record<string,Movie>;users:Person[];summary:Record<string,number>};
const input:Input=await Bun.file(Bun.argv[2]).json();
const {movies}=input;
const privateRows: {arm:string;user:string;title:string;rating:number;base:number;score:number}[]=[];
const experiments=[{key:'one',minimum:1,attenuate:false},{key:'two',minimum:2,attenuate:false}];
if(Bun.argv[3]==='shadow')experiments.push({key:'oneAttenuated',minimum:1,attenuate:true},{key:'twoAttenuated',minimum:2,attenuate:true});
const counts=()=>({eligible:0,scored:0,changed:0,correctRed:0,likedRed:0,middlingRed:0,
  fiveLowered:0,fiveLostGreen:0,fiveNewlyRed:0,redToLower:0,netUtilityErrorChange:0,changedDislikes:0,changedMiddle:0,changedLiked:0});
const analyses=experiments.map(test=>({...test,counts:counts(),participants:new Set<string>(),teams:new Set<string>(),
  benefits:new Set<string>(),harms:new Set<string>(),likedHarmTeams:new Set<string>(),usefulTeams:new Set<string>(),
  fiveHarmUsers:new Set<string>(),beforeError:0,afterError:0,direction:{closer:0,farther:0,equal:0}}));
const utility=(s:number)=>s<=3?Math.max(0,20*(s-.5)):50+30*Math.min(1,s-3)+20*Math.max(0,s-4);
const fold=(family:string)=>parseInt(createHash('sha256').update('coast-external-director:'+family).digest('hex').slice(0,8),16)%3;
for(const u of input.users){
  const asOf=u.cutoff*86400000-1;
  const stars=new Map(u.train.map(([,id,rating])=>[id,rating]));
  const rows:TasteV2Observation[]=u.train.map(([day,id,rating])=>({
    work:{id,kind:'movie',medium:'movie',rating,lastRatedAt:new Date(day*86400000).toISOString(),
      explicit:0,implicit:0,chosen:false,dropped:false,repeated:false,consumed:false},
    features:movies[id].features
  }));
  const reference=trainTasteV2('movie',rows,{asOf,stage:'calibrated'});
  const residuals=new Map<string,number>();
  const donorIds=new Set(Object.values(u.donors).flatMap(b=>Object.values(b).flat()));
  for(let k=0;k<3;k++){
    const withheld=[...donorIds].filter(id=>fold(movies[id].family)===k);
    if(!withheld.length)continue;
    const inner=trainTasteV2('movie',rows.filter(r=>fold(movies[r.work.id].family)!==k),{asOf,stage:'calibrated'});
    for(const id of withheld){
      const score=scoreTasteV2(inner,movies[id].features,{details:false}).score;
      if(score!==null)residuals.set(id,utility(stars.get(id)!)-score);
    }
  }
  for(const [,id,rating] of u.held){
    const base=scoreTasteV2(reference,movies[id].features,{details:false}).score;
    const effects=Object.values(u.donors[id]).map(group=>group.filter(i=>residuals.has(i)).map(i=>residuals.get(i)!)).filter(g=>g.length)
      .map(group=>group.reduce((s,n)=>s+n,0)/group.length);
    for(const a of analyses){
      if(effects.length<a.minimum)continue;
      const c=a.counts;c.eligible++;
      if(base===null)continue;
      c.scored++;
      const shift=Math.min(0,effects.reduce((s,n)=>s+n,0)/effects.length);
      const weight=a.attenuate?effects.length/(effects.length+1):1;
      const score=Math.max(0,Math.round(base+weight*shift));
      if(process.env.COAST_PUBLIC_TRANSFER_PAIRS)privateRows.push({arm:a.key,user:u.id,title:id,rating,base,score});
      a.beforeError+=Math.abs(base-utility(rating));
      a.afterError+=Math.abs(score-utility(rating));
      if(score>=base)continue;
      c.changed++;a.participants.add(u.id);const team=movies[id].crew.join('/');a.teams.add(team);
      c.changedDislikes+=+(rating<=2.5);c.changedMiddle+=+(rating>2.5&&rating<4);c.changedLiked+=+(rating>=4);
      if(rating===5){c.fiveLowered++;a.fiveHarmUsers.add(u.id);if(base>=80&&score<80)c.fiveLostGreen++;if(base>=50&&score<50)c.fiveNewlyRed++;}
      const errorChange=Math.abs(score-utility(rating))-Math.abs(base-utility(rating));
      c.netUtilityErrorChange+=errorChange;
      a.direction[errorChange<0?'closer':errorChange>0?'farther':'equal']++;
      if(score<50&&base>=50){
        if(rating<=2.5){c.correctRed++;a.benefits.add(u.id);a.usefulTeams.add(team);}
        else if(rating>=4){c.likedRed++;a.harms.add(u.id);a.likedHarmTeams.add(team);}
        else c.middlingRed++;
      }else if(base<50)c.redToLower++;
    }
  }
}
if(process.env.COAST_PUBLIC_TRANSFER_PAIRS){
  await writeFile(process.env.COAST_PUBLIC_TRANSFER_PAIRS, JSON.stringify(privateRows),{flag:'wx',mode:0o600});
}
console.log(JSON.stringify({sample:input.summary,arms:Object.fromEntries(analyses.map(a=>[a.key,{...a.counts,
  affectedUsers:a.participants.size,affectedDirectorTeams:a.teams.size,usersWithLoweredFive:a.fiveHarmUsers.size,
  correctRedTeams:a.usefulTeams.size,falseLikedRedTeams:a.likedHarmTeams.size,predictionError:a.direction,
  eligibleMeanAbsoluteError:a.counts.scored?[a.beforeError/a.counts.scored,a.afterError/a.counts.scored]:[],
  usersWithNewCorrectRed:a.benefits.size,usersWithNewLikedRed:a.harms.size}]))},null,2));
