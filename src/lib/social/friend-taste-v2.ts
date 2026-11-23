// This module only accepts evidence the caller has already filtered for the viewer.

type VisibleAffinity = {
  dimension:string; id:string; name:string; affinity:number; confidence:number; works:number; independent:number;
};
type RatedPair = {mine:number;theirs:number};
export type FriendTraitMatch = {dimension:string;name:string;you:number;friend:number;works:number};

export function compareVisibleTastesV2(left:readonly VisibleAffinity[],right:readonly VisibleAffinity[],ratings:readonly RatedPair[] | {works:number;score:number|null}) {
  const other=new Map(right.map(trait=>[trait.dimension+':'+trait.id,trait]));
  const families=new Map<string,{sum:number;weight:number}>();
  const examples:FriendTraitMatch[]=[];
  for (const a of left) {
    const b=other.get(a.dimension+':'+a.id);
    if (!b || Math.min(a.independent,b.independent)<2) continue;
    const weight=Math.min(a.confidence,b.confidence)/100;
    if (weight<=0) continue;
    // Shared neutrality supplies no evidence of agreement. Both direction and strength matter.
    const yours=a.affinity-50, theirs=b.affinity-50;
    const opinion=Math.sign(yours*theirs)*Math.min(Math.abs(yours),Math.abs(theirs));
    if (!opinion) continue;
    const family=families.get(a.dimension)??{sum:0,weight:0};
    family.sum+=weight*(50+opinion);family.weight+=weight;families.set(a.dimension,family);
    examples.push({name:a.name,dimension:a.dimension,you:a.affinity,friend:b.affinity,works:Math.min(a.independent,b.independent)});
  }
  let sum=0,weight=0;
  for (const family of families.values()) {
    // Dozens of cast credits from a single film must not outvote all other families.
    const support=Math.min(1,family.weight);
    sum+=support*family.sum/family.weight;weight+=support;
  }
  examples.sort((a,b)=>Math.min(Math.abs(b.you-50),Math.abs(b.friend-50))-Math.min(Math.abs(a.you-50),Math.abs(a.friend-50))
    ||b.works-a.works||a.dimension.localeCompare(b.dimension)||a.name.localeCompare(b.name));
  const traits=examples.length;
  const preferences={score:traits>=2&&weight>0?Math.round(sum/weight):null,traits,examples:examples.slice(0,6)};
  const agreement='works' in ratings ? ratings : {score:ratings.length>=5
    ?Math.round(100*(1-ratings.reduce((total,p)=>total+Math.abs(p.mine-p.theirs),0)/(4.5*ratings.length))):null,
    works:ratings.length};
  const agreementWeight=agreement.score===null?0:agreement.works/(agreement.works+8);
  const traitWeight=preferences.score===null?0:weight/(weight+2);
  const total=agreementWeight+traitWeight;
  const byDimension=Object.fromEntries([...families].map(([dimension,support])=>[dimension,{
    score:Math.round(support.sum/support.weight),shared:examples.filter(row=>row.dimension===dimension).length,
    left:left.filter(row=>row.dimension===dimension&&row.independent>=2).length,
    right:right.filter(row=>row.dimension===dimension&&row.independent>=2).length,weight:Math.min(1,support.weight)
  }]));
  return {agreement,preferences,byDimension,score:total?Math.round(((agreement.score??0)*agreementWeight+(preferences.score??0)*traitWeight)/total):null};
}

const peerWeight=.15;
const starFit=(stars:number)=>50+50*(stars-3)/(stars<3?2.5:2);
const blend=(personal:number,friendRating:number|null)=>friendRating===null?Math.round(personal+.04*(100-personal))
  :Math.round((1-peerWeight)*personal+peerWeight*starFit(friendRating));
const validStars=(n:number)=>Number.isFinite(n)&&n>=.5&&n<=5;

export type PairedFriendForecastV2 = {
  id:string;personal:number;friendStars:number|null;viewerStars:number;
  predictedAt:string;friendObservedAt:string;viewerRatedAt:string;
  genres?:readonly string[]; franchise?:string;
};
type PeerGate='insufficient-evidence'|'no-measured-gain'|'validated';

function measurements(rows:readonly PairedFriendForecastV2[],priorPeerStars?:number) {
  let personalError=0,assistedError=0,constantPeerError=0,improved=0,worse=0;
  const ratingSum=rows.reduce((sum,row)=>sum+(row.friendStars??0),0);
  let weak=0,liked=0,personalWeakGreen=0,assistedWeakGreen=0,personalLikedGreen=0,assistedLikedGreen=0;
  let personalFavouriteGreen=0,assistedFavouriteGreen=0;
  const reveals=new Map<string,{count:number;gain:number}>();
  for (const row of rows) {
    const actual=starFit(row.viewerStars), after=blend(row.personal,row.friendStars);
    const beforeError=Math.abs(row.personal-actual),afterError=Math.abs(after-actual);
    personalError+=beforeError;assistedError+=afterError;
    if(row.friendStars!==null && rows.length>1) {
      const typical=priorPeerStars??(ratingSum-row.friendStars)/(rows.length-1);
      constantPeerError+=Math.abs(blend(row.personal,typical)-actual);
    }
    const day=new Date(row.viewerRatedAt).toISOString().slice(0,10);
    const reveal=reveals.get(day)??{count:0,gain:0};
    reveal.count++;reveal.gain+=beforeError-afterError;reveals.set(day,reveal);
    if(row.viewerStars===5) {
      personalFavouriteGreen+=Number(row.personal>=80);assistedFavouriteGreen+=Number(after>=80);
    }
    improved+=Number(afterError<beforeError);worse+=Number(afterError>beforeError);
    if (row.viewerStars<=3) {
      weak++;personalWeakGreen+=Number(row.personal>=80);assistedWeakGreen+=Number(after>=80);
    } else if (row.viewerStars>=4) {
      liked++;personalLikedGreen+=Number(row.personal>=80);assistedLikedGreen+=Number(after>=80);
    }
  }
  const dayMeanGain=reveals.size?[...reveals.values()].reduce((total,r)=>total+r.gain/r.count,0)/reveals.size:null;
  return {works:rows.length,groups:new Set(rows.map(row=>row.franchise||row.id)).size,weak,liked,days:reveals.size,dayMeanGain,personalError:rows.length?personalError/rows.length:null,
    assistedError:rows.length?assistedError/rows.length:null,constantPeerError:rows.length?constantPeerError/rows.length:null,improved,worse,
    personalWeakGreen,assistedWeakGreen,personalLikedGreen,assistedLikedGreen,personalFavouriteGreen,assistedFavouriteGreen};
}

/** A fixed candidate blend, measured on chronological early and late blocks before it may contribute.
 * Inputs are forecasts frozen before the viewer's subsequent verified direct rating. */
export function validateFriendForecastsV2(input:readonly PairedFriendForecastV2[],excludeRoot:string,kind:'rating'|'watch'='rating',asOf=Date.now()) {
  const byRoot=new Map<string,PairedFriendForecastV2>(),conflicts=new Set<string>();
  for (const row of input) {
    const prediction=Date.parse(row.predictedAt),friendTime=Date.parse(row.friendObservedAt),viewerTime=Date.parse(row.viewerRatedAt);
    if (row.id===excludeRoot || (kind==='rating' ? row.friendStars===null||!validStars(row.friendStars) : row.friendStars!==null) || !validStars(row.viewerStars) ||
      !Number.isFinite(row.personal)||row.personal<0||row.personal>100||!(friendTime<=prediction&&prediction<viewerTime&&viewerTime<=asOf)) continue;
    const older=byRoot.get(row.id);
    if (older && (older.friendStars!==row.friendStars||older.viewerStars!==row.viewerStars||Date.parse(older.viewerRatedAt)!==viewerTime)) {
      conflicts.add(row.id);continue;
    }
    if (!older||Date.parse(older.predictedAt)>prediction) byRoot.set(row.id,row);
  }
  const rows=[...byRoot.values()].filter(row=>!conflicts.has(row.id)).sort((a,b)=>Date.parse(a.viewerRatedAt)-Date.parse(b.viewerRatedAt)||a.id.localeCompare(b.id));
  // A bulk rating day cannot be split to manufacture independent validation.
  const splitDay=rows.length?new Date(rows[Math.floor(rows.length*.6)].viewerRatedAt).toISOString().slice(0,10):'';
  const day=(row:PairedFriendForecastV2)=>new Date(row.viewerRatedAt).toISOString().slice(0,10);
  const earlyRows=rows.filter(row=>day(row)<splitDay);
  const typical=kind==='rating'&&earlyRows.length?earlyRows.reduce((total,row)=>total+row.friendStars!,0)/earlyRows.length:undefined;
  const earlier=measurements(earlyRows),later=measurements(rows.filter(row=>day(row)>=splitDay),typical);
  const enough=(sample:typeof earlier)=>sample.weak>=2&&sample.liked>=2&&sample.days>=3&&sample.groups>=3;
  const passes=(sample:typeof earlier)=>sample.assistedError!<sample.personalError! && sample.improved>sample.worse &&
    (kind==='watch'||sample.assistedError!<sample.constantPeerError!) && sample.dayMeanGain!>0 && sample.assistedWeakGreen<=sample.personalWeakGreen && sample.assistedLikedGreen>=sample.personalLikedGreen &&
    sample.assistedFavouriteGreen>=sample.personalFavouriteGreen;
  let state:PeerGate='insufficient-evidence';
  if (earlier.works>=12&&later.works>=8&&enough(earlier)&&enough(later)) state=passes(earlier)&&passes(later)?'validated':'no-measured-gain';
  return {state,earlier,later};
}

// Predeclare a single neighbourhood so inspecting a target cannot cherry-pick its most flattering tag.
// A complete, supported local test can also veto a peer who generally helps elsewhere.
export function validatedFriendContextV2(rows:readonly PairedFriendForecastV2[],root:string,kind:'rating'|'watch',genres:readonly string[]) {
  const all=validateFriendForecastsV2(rows,root,kind);
  const target=new Set(genres);
  if (!target.size) return {scope:'medium' as const,gate:all};
  const similar=rows.filter(row=>{
    const evidence=new Set(row.genres??[]);
    let common=0;
    for(const genre of evidence) if(target.has(genre))common++;
    return common>0 && common/(target.size+evidence.size-common)>=.5;
  });
  const local=validateFriendForecastsV2(similar,root,kind);
  if(local.state==='insufficient-evidence')return {scope:'medium' as const,gate:all};
  return {scope:'genres' as const,gate:local};
}

export function compareFriendItemV2(personalScore:number|null,friendStars:number|null,gate:ReturnType<typeof validateFriendForecastsV2>,watched=false) {
  const assistedScore=gate.state==='validated'&&personalScore!==null&&(friendStars===null?watched:validStars(friendStars))?blend(personalScore,friendStars):null;
  const reason=personalScore===null?'no-personal-score':friendStars===null&&!watched?'no-visible-opinion':gate.state;
  return {personalScore,assistedScore,reason,calibrationWorks:gate.earlier.works+gate.later.works};
}
