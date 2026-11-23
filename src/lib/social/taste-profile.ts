import { isDescriptiveTasteDimension, ratingInfluence, ratingVote, tasteCombinations, tasteRatingAdjustment, tasteReturnTieBreak, type FriendTasteAdjustment, type TasteRatingTerm } from './taste-rating-model';
import { tasteSelectionAdjustment, type TasteSelection, type TasteSelectionBreakdown, type TasteSelectionSummary } from './taste-selection';
import {applicableCreatorPattern,type CreatorPreferences} from './taste-creators';

export const tasteMedia = [
 {value:'movie',comparison:'movies',label:'Movies',category:'screen'},
 {value:'show',comparison:'tv',label:'Shows',category:'screen'},
 {value:'music',comparison:'music',label:'Music',category:'music'},
 {value:'game',comparison:'game',label:'Games',category:'game'},
 {value:'book',comparison:'book',label:'Books',category:'book'},
 {value:'comic',comparison:'comic',label:'Comics',category:'comic'},
] as const;
export type TasteMedium = typeof tasteMedia[number]['value'];
export function mediumForTasteKind(kind?:string):TasteMedium|undefined {
 if(kind==='album'||kind==='track'||kind==='artist')return 'music';
 if(kind==='season'||kind==='episode')return 'show';
 return tasteMedia.find(medium=>medium.value===kind)?.value;
}
export const tasteDimensions = ['genres','tags','themes','cast','directors','writers','illustrators','composers','cinematographers','franchises','developers','publishers','mechanics','perspectives','artists','studios','networks','languages','countries','decades','ageRatings'] as const;
export type TasteDimension = typeof tasteDimensions[number];
const screenDimensions=['genres','tags','themes','cast','directors','writers','franchises','studios','decades','ageRatings','countries','languages','composers','cinematographers'] as const;
export const tasteDimensionsByMedium = {
 movie:screenDimensions,
 show:[...screenDimensions,'networks'],
 music:['genres','tags','artists','writers','studios','decades','composers'],
 game:['genres','tags','themes','developers','publishers','franchises','mechanics','perspectives','languages','decades'],
 book:['genres','tags','writers','publishers','franchises','languages','decades'],
 comic:['genres','tags','themes','writers','illustrators','publishers','franchises','languages','decades'],
} as const satisfies Record<TasteMedium,readonly TasteDimension[]>;
export type TasteFeature = {id:string;name:string};
export type TasteFeatures = Partial<Record<TasteDimension,TasteFeature[]>>;
export type TasteEvidence = {id:string;weight:number;features:TasteFeatures};
export type TasteAffinity = TasteFeature & {
 value:number;samples:number;explicitSamples?:number;consumedSamples?:number;repeatedSamples?:number;positiveFeedbackSamples?:number;
 medianRating?:number;
 viewingChoice?: TasteSelectionSummary;
};
export type TasteProfile = {version:1;works:number;dimensions:Partial<Record<TasteDimension,TasteAffinity[]>>};
export type TasteWorkEvidence = {rating:number|null;explicit:number;implicit:number;dropped?:boolean;consumed:boolean;repeated:boolean;ratingReliability?:number;lastExperiencedAt?:Date|string|null;lastRatedAt?:Date|string|null;playtimeRank?:number|null;completion?:boolean|null;
 deliberateReturn?:boolean;watchHabits?:{pace?:number;binge?:number;behind?:number}|null};
export type SavedAffinity = [id:string,name:string,value:number,samples:number,positive:number,negative:number,explicitSamples:number,
 consumedSamples:number,repeatedSamples:number,positiveFeedbackSamples:number,inferredConsumedSamples:number,
 medianRating?:number|null,opinionWeight?:number,neutralOnlySamples?:number,preferenceSupport?:number,independence?:number];
type SignalPreview = Pick<TasteAffinity,'name'|'value'|'samples'>;
export type LifetimeTasteProfile = {
 version:3;works:number;worksWithSignals:number;explicitWorks:number;inferredWorks:number;consumedWorks:number;repeatedWorks:number;ratings:number;medianRating:number|null;
 dimensions:Partial<Record<TasteDimension,SavedAffinity[]>>;
 signals:Partial<Record<TasteDimension,{count:number;preview:SignalPreview[]}>>;
};
export type SavedTasteProfile = TasteProfile | LifetimeTasteProfile;

export function namedFeatures(names:string[]):TasteFeature[] {
 const features=new Map<string,TasteFeature>();
 for(const raw of names){
  const name=raw.trim(),id=name.toLocaleLowerCase('en-US');
  if(name&&!features.has(id))features.set(id,{id,name});
  if(features.size===100)break;
 }
 return [...features.values()];
}

type Outcomes = {positive:number;decided:number;finished:number;completionSamples:number};
type DatedChoice = {time:number;recent:boolean;weight:number;value:number};
type PreferenceTrend = {
 recent?:{count:number;first:number;last:number;weight:number;signed:number};
 earlier?:{count:number;weight:number;signed:number};
};
type AffinityTotals = TasteFeature & {
 positive:number;negative:number;samples:number;explicitSamples:number;consumedSamples:number;repeatedSamples:number;
 positiveFeedbackSamples:number;explicitTotal:number;opinionWeight:number;neutralOnlySamples:number;inferredConsumedSamples:number;inferredRepeatedSamples:number;
 explicitConsumedSamples:number;explicitRepeatedSamples:number;explicitReturnStrength:number;
 ratings?:{buckets:Uint32Array;count:number};
 outcomes?:Outcomes;
 franchiseCounts?:Map<string,number>;
 experienceTrend?:PreferenceTrend;
 ratingTrend?:PreferenceTrend;
};
type DimensionTotals = {inferredConsumed:number;inferredRepeated:number;explicitConsumed:number;explicitRepeated:number;experienceTrend?:PreferenceTrend;outcomes?:Outcomes};
type Observations = {
 explicit:boolean;weight:number;consumed:boolean;repeated:boolean;returned:boolean;positiveFeedback:boolean;rating:number|null;
 opinion:boolean|null;completion:boolean|null;strongReturn?:boolean;franchise?:string;experience?:DatedChoice;ratingChoice?:DatedChoice;
};
type CombinationTotals = {left:AffinityTotals;right:AffinityTotals;consumed:number;returned:number};
function featureTotals<T>(){
 return new Map(tasteDimensions.map(dimension=>[dimension,new Map<string,T>()]));
}

// A repeated provider feature on the same canonical work cannot supply another vote.
function visitFeatures(features:TasteFeatures,visit:(dimension:TasteDimension,feature:TasteFeature)=>void,visitDimension?:(dimension:TasteDimension)=>void){
 let contributed=false;
 for(const dimension of tasteDimensions){
  const entries=features[dimension];
  if(!entries?.length)continue;
  const seen=new Set<string>();
  for(const feature of entries){
   if(!feature.id||seen.has(feature.id))continue;
   seen.add(feature.id);
   visit(dimension,feature);
   contributed=true;
  }
  if(seen.size)visitDimension?.(dimension);
 }
 return contributed;
}

function recordOutcome(target:{outcomes?:Outcomes},{opinion,completion}:Observations){
 if(opinion===null&&completion===null)return;
 const counts=target.outcomes??={positive:0,decided:0,finished:0,completionSamples:0};
 if(opinion!==null){
  counts.decided++;
  if(opinion)counts.positive++;
 }
 if(completion!==null){
  counts.completionSamples++;
  if(completion)counts.finished++;
 }
}

function recordVote(totals:Map<TasteDimension,Map<string,AffinityTotals>>,known:Map<TasteDimension,DimensionTotals>,features:TasteFeatures,vote:number,observations:Observations){
 const weightedVote=vote*observations.weight;
 const ratedReturnEvidence=observations.explicit&&observations.consumed&&vote>=0&&
 (vote>0||observations.returned);
 return visitFeatures(features,(dimension,{id,name})=>{
  const values=totals.get(dimension)!;
  let entry=values.get(id);
  if(!entry){
   entry={id,name,positive:0,negative:0,samples:0,explicitSamples:0,consumedSamples:0,repeatedSamples:0,
    positiveFeedbackSamples:0,explicitTotal:0,opinionWeight:0,neutralOnlySamples:0,inferredConsumedSamples:0,inferredRepeatedSamples:0,
    explicitConsumedSamples:0,explicitRepeatedSamples:0,explicitReturnStrength:0};
   values.set(id,entry);
  }
  entry.positive+=Math.max(0,weightedVote);
  entry.negative+=Math.max(0,-weightedVote);
  entry.samples++;
  if(observations.franchise&&independenceDimensions.has(dimension)){
   const counts=entry.franchiseCounts??=new Map();
   counts.set(observations.franchise,(counts.get(observations.franchise)??0)+1);
  }
  if(observations.ratingChoice)recordDatedChoice(entry.ratingTrend??={},observations.ratingChoice);
  if(observations.experience)recordDatedChoice(entry.experienceTrend??={},observations.experience);
  if(observations.explicit){
   entry.explicitSamples++;
   entry.explicitTotal+=weightedVote;
   // A deliberate return can support a feature even after a neutral rating.
   const weight=vote===0&&observations.returned?inferredMass:observations.weight;
   entry.opinionWeight+=weight;
   if(vote===0&&!observations.returned)entry.neutralOnlySamples++;
   if(ratedReturnEvidence){
    entry.explicitConsumedSamples++;
    if(observations.returned){
     entry.explicitRepeatedSamples++;
     if(!observations.strongReturn)entry.explicitReturnStrength+=(1-vote)*weight;
    }
   }
  }else if(observations.consumed){
   entry.inferredConsumedSamples++;
   if(observations.returned)entry.inferredRepeatedSamples++;
  }
  if(observations.rating!==null){
   const ratings=entry.ratings??={buckets:new Uint32Array(21),count:0};
   // Quarter-stars also preserve the usual median of two half-star episode ratings.
   ratings.buckets[Math.min(20,Math.max(0,Math.round(observations.rating*4)))]++;
   ratings.count++;
  }
  if(observations.consumed)entry.consumedSamples++;
  if(observations.repeated)entry.repeatedSamples++;
  if(observations.positiveFeedback)entry.positiveFeedbackSamples++;
  recordOutcome(entry,observations);
 },dimension=>{
  const counts=known.get(dimension)!;
  recordOutcome(counts,observations);
  if(observations.experience)recordDatedChoice(counts.experienceTrend??={},observations.experience);
  if(ratedReturnEvidence){
   counts.explicitConsumed++;
   if(observations.returned)counts.explicitRepeated++;
  }else if(!observations.explicit&&observations.consumed){
   counts.inferredConsumed++;
   if(observations.returned)counts.inferredRepeated++;
  }
 });
}

function byAffinity(a:TasteAffinity,b:TasteAffinity){
 return Math.abs(b.value)-Math.abs(a.value)||b.samples-a.samples||a.id.localeCompare(b.id);
}

/** The two-person overlap uses only the evidence visible to both participants. */
export function buildTasteProfile(evidence:TasteEvidence[]):TasteProfile {
 const works=new Map<string,TasteEvidence>();
 for(const work of evidence){
  const existing=works.get(work.id);
  if(!existing||(work.weight<0?work.weight<existing.weight:existing.weight>=0&&work.weight>existing.weight))works.set(work.id,work);
 }
 const totals=featureTotals<TasteAffinity>(),dimensions:TasteProfile['dimensions']={};
 for(const {weight,features} of works.values()){
  if(!weight)continue;
  const vote=Math.max(-6,Math.min(5,weight));
  visitFeatures(features,(dimension,{id,name})=>{
   const values=totals.get(dimension)!,entry=values.get(id);
   if(entry){entry.samples++;entry.value+=vote;}
   else values.set(id,{id,name,value:vote,samples:1});
  });
 }
 for(const [dimension,values] of totals){
  for(const entry of values.values())entry.value=Math.max(-1,Math.min(1,entry.value/(5*Math.max(3,entry.samples))));
  dimensions[dimension]=[...values.values()].sort(byAffinity).slice(0,500);
 }
 return {version:1,works:works.size,dimensions};
}

type RatingSummary = {count:number;median:number|null};

const inferredMass=0.5;
// Repeat evidence has its own count. A completion contributes the same base vote on later plays.
const inferredPreference=[0,0.10,0.18,0.34,0.34] as const;
function workVote({rating,ratingReliability=1,explicit,implicit,dropped,consumed,playtimeRank,watchHabits}:TasteWorkEvidence,negativeWeight:number,strongReturn:boolean){
 // A low rating corroborates a drop without supplying a second observation.
 if(dropped&&(rating===null||rating<=3))
  return {value:-1,explicit:true,weight:1+(rating!==null&&rating<3?ratingInfluence(rating)*ratingReliability:0)};
 // Verified deliberate returns can express a preference almost as strongly as five stars.
 if(strongReturn)return {value:0.9+0.1*ratingVote(rating??3),explicit:true,weight:1};
 const behind=watchHabits?.behind??0;
 if(rating!==null){
  const value=ratingVote(rating,negativeWeight);
  const weight=ratingInfluence(rating)*ratingReliability;
  const penalty=0.34*behind*(rating>=4?0:rating>3?0.25:1);
  if(penalty>0&&(rating!==3||!explicit))
   return {value:Math.max(-1,value-penalty),explicit:true,weight:Math.max(weight,penalty)};
  if(value||!explicit)return {value,explicit:true,weight};
 }
 if(explicit)return {value:Math.max(-1,Math.min(1,explicit/5)),explicit:true,weight:1};
 // A dropped child without a direct decision about its parent supplies weak evidence.
 const preference=implicit<0?-0.30:inferredPreference[Math.min(4,Math.max(0,implicit))];
 // Lifetime playtime measures exposure. Give above-usual play a small bonus only, since the
 // length of a game is unknown and a short completed game can be just as much a favourite.
 const duration=consumed&&implicit>0?0.12*Math.max(0,Math.min(1,playtimeRank??0)):0;
 // An overdue episode weakens an unrated viewing signal. A backlog alone supplies little evidence of dislike.
 const habits=implicit>=0?0.24*(watchHabits?.pace??0)+0.22*(watchHabits?.binge??0)-0.18*behind:0;
 return {value:(preference+duration+habits)*inferredMass,explicit:false,weight:1};
}

const compact=(value:number)=>Math.round(value*10000)/10000;
const contextDimensions=new Set<TasteDimension>(['publishers','mechanics','perspectives','studios','networks','languages','countries','decades','composers','ageRatings']);
const personDimensions:ReadonlySet<TasteDimension>=new Set(['cast','directors','writers','illustrators','composers','cinematographers','artists']);
const independenceDimensions:ReadonlySet<TasteDimension>=new Set([...personDimensions,'studios','networks','developers','publishers']);
const dayMs=86_400_000;
function independentSupport(entry:AffinityTotals){
 if(!entry.franchiseCounts)return 1;
 let duplicateMass=0;
 for(const count of entry.franchiseCounts.values())duplicateMass+=count-Math.sqrt(count);
 return compact(1-0.65*duplicateMass/entry.samples);
}
function datedChoice(when:Date|string|null|undefined,asOf:number,value:number,weight:number):DatedChoice|undefined{
 if(!when||weight<=0)return;
 const time=when instanceof Date?when.getTime():Date.parse(when);
 if(!Number.isFinite(time)||time>asOf)return;
 return {time,recent:time>=asOf-90*dayMs,weight,value};
}
function recordDatedChoice(trend:PreferenceTrend,{time,recent,weight,value}:DatedChoice){
 if(recent){
  const bucket=trend.recent??={count:0,first:time,last:time,weight:0,signed:0};
  bucket.count++;bucket.weight+=weight;bucket.signed+=weight*value;
  bucket.first=Math.min(bucket.first,time);bucket.last=Math.max(bucket.last,time);
 }else{
  const bucket=trend.earlier??={count:0,weight:0,signed:0};
  bucket.count++;bucket.weight+=weight;bucket.signed+=weight*value;
 }
}
function recentPreference(trend:PreferenceTrend|undefined){
 const r=trend?.recent,past=trend?.earlier;
 if(!r||!past||r.count<5||past.count<8||r.last-r.first<21*dayMs||past.weight<3||r.weight<3)return;
 const difference=r.signed/r.weight-past.signed/past.weight;
 return Math.max(-0.12,Math.min(0.12,difference*.2))*r.count/(r.count+6);
}
// Recently chosen works have had less time to earn returns. Only reinforce a rising
// pattern when these titles also stand out against other choices in the same period.
function recentReturnPreference(feature:PreferenceTrend|undefined,dimension:PreferenceTrend|undefined){
 const recent=feature?.recent,earlier=feature?.earlier,allRecent=dimension?.recent,allEarlier=dimension?.earlier;
 if(!recent||!earlier||!allRecent||!allEarlier||recent.count<5||earlier.count<8||
    recent.last-recent.first<21*dayMs||recent.signed<3)return 0;
 if(allRecent.count-recent.count<5||allEarlier.count-earlier.count<8)return 0;
 const currentLift=relativeRate(recent.signed,recent.count,allRecent.signed,allRecent.count);
 const priorLift=relativeRate(earlier.signed,earlier.count,allEarlier.signed,allEarlier.count);
 const increase=recent.signed/recent.count-earlier.signed/earlier.count;
 const supported=Math.max(0,Math.min(currentLift-priorLift,currentLift,increase));
 return Math.min(.12,.2*supported)*recent.count/(recent.count+6);
}
const minimumAffinitySamples = (dimension:TasteDimension) => dimension==='cast'?3:2;

// Wilson bounds keep a perfect record on a handful of titles from outweighing a larger sample.
// Compare distinct titles with/without the feature, among titles with metadata in that dimension.
function rateBound(positive:number,total:number,upper:boolean){
 const z=1.96,z2=z*z,p=positive/total;
 const margin=z*Math.sqrt(p*(1-p)/total+z2/(4*total*total));
 return (p+z2/(2*total)+(upper?margin:-margin))/(1+z2/total);
}
function relativeRate(positive:number,total:number,allPositive:number,all:number){
 const other=all-total,otherPositive=allPositive-positive;
 if(total<=0||other<=0)return 0;
 const difference=positive*other-otherPositive*total;
 if(!difference)return 0;
 if(difference>0)return Math.max(0,rateBound(positive,total,false)-rateBound(otherPositive,other,true));
 return Math.min(0,rateBound(positive,total,true)-rateBound(otherPositive,other,false));
}

function preferenceEvidence(entry:AffinityTotals,known:DimensionTotals){
 if(!entry.outcomes||!known.outcomes)return {completion:0,opinion:0,agreement:0,majoritySupport:0};
 const own=entry.outcomes,all=known.outcomes;
 const completion=Math.max(0,relativeRate(own.finished,own.completionSamples,all.finished,all.completionSamples));
 const opinion=relativeRate(own.positive,own.decided,all.positive,all.decided);
 // Keep small majorities from dominating.
 const margin=2*own.positive-own.decided;
 const agreement=margin/(own.decided+8);
 const majoritySupport=margin?Math.sign(margin)*Math.max(0,
  2*rateBound(Math.max(own.positive,own.decided-own.positive),own.decided,false)-1):0;
 return {completion,opinion,agreement,majoritySupport};
}

function featureMedian(ratings:AffinityTotals['ratings']){
 if(!ratings)return undefined;
 const lower=Math.floor((ratings.count-1)/2),upper=Math.floor(ratings.count/2);
 let seen=0,sum=0;
 for(const [bucket,count] of ratings.buckets.entries()){
  const end=seen+count;
  if(seen<=lower&&lower<end)sum+=bucket;
  if(seen<=upper&&upper<end)return (sum+bucket)/8;
  seen=end;
 }
}

function inferredReturnStrength(returned:number,consumed:number,known:DimensionTotals){
 if(!returned)return 0;
 const selective=Math.max(0,relativeRate(returned,consumed,known.inferredRepeated,known.inferredConsumed));
 return 0.50*consumed/(consumed+4)*(returned/consumed+selective)+0.13*selective;
}

/** A combination matters when its return rate differs from both parts alone. */
function combinationReturnWeights(combinations:Map<string,CombinationTotals>){
 const entries:Array<[string,number]>=[];
 for(const [key,{left,right,consumed,returned}] of combinations){
  if(consumed<5)continue;
  const a=relativeRate(returned,consumed,left.explicitRepeatedSamples+left.inferredRepeatedSamples,left.explicitConsumedSamples+left.inferredConsumedSamples);
  const b=relativeRate(returned,consumed,right.explicitRepeatedSamples+right.inferredRepeatedSamples,right.explicitConsumedSamples+right.inferredConsumedSamples);
  if(a*b<=0)continue;
  const value=compact(Math.sign(a)*Math.min(Math.abs(a),Math.abs(b))*consumed/(consumed+12));
  if(value)entries.push([key,value]);
 }
 entries.sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])||a[0].localeCompare(b[0]));
 return entries.length?Object.fromEntries(entries.slice(0,256)):undefined;
}

/** Combine opinions, first-time exposure and returns while keeping one vote per title. */
function lifetimeAffinity(entry:AffinityTotals,dimension:TasteDimension,consumedWorks:number,known:DimensionTotals,completion:number,agreement:number){
 const inferred=entry.samples-entry.explicitSamples;
 const observed=inferred*inferredMass;
 const base=observed?(entry.positive-entry.negative-entry.explicitTotal)/observed:0;
 const consumed=entry.inferredConsumedSamples;
 const reach=consumed/Math.max(1,consumedWorks);
 // Frequency of a language, country or studio is largely a property of the available catalogue.
 const frequencyWeight=contextDimensions.has(dimension)?0.25:1;
 const exposure=frequencyWeight*(0.12*reach*consumed/(consumed+4)+0.12*consumed/(consumed+8));
 const behaviour=base<0?base:Math.min(1,base+exposure);
 const unratedReturns=base<0?0:Math.min(1-behaviour,frequencyWeight*inferredReturnStrength(entry.inferredRepeatedSamples,consumed,known));
 // A return can reinforce a positive or neutral opinion by part of its remaining room.
 // It contributes no additional rating, support sample or negative vote.
 const selective=entry.explicitRepeatedSamples?
  Math.max(0,relativeRate(entry.explicitRepeatedSamples,entry.explicitConsumedSamples,known.explicitRepeated,known.explicitConsumed)):0;
 const explicitReturns=(0.25+0.15*selective)*frequencyWeight*entry.explicitReturnStrength;
 const measured=entry.opinionWeight+observed;
 const affinity=measured?(entry.explicitTotal+observed*(behaviour+unratedReturns)+explicitReturns)/measured:0;
 // Completion corroborates a preference without cancelling a stated dislike.
 const supported=affinity>=0?affinity+.12*completion*(1-Math.min(1,affinity)):affinity;
 // Decisive vote counts can reinforce a weighted opinion in the same direction.
 const bonus=agreement*affinity>0?.15*agreement*(1-Math.min(1,Math.abs(supported))):0;
 return compact(.98*Math.max(-1,Math.min(1,supported+bonus)));
}

function creditSupport(entry:AffinityTotals,value:number){
 const samples=entry.samples-entry.neutralOnlySamples;
 return Math.abs(value)*samples/(samples+3)+0.12*Math.log1p(entry.inferredConsumedSamples+2*entry.opinionWeight);
}

function affinityEvidence(samples:number,explicit:number,observed:number,positive:number,negative:number,opinionWeight:number,preferenceSupport=0){
 const mass=opinionWeight+observed*inferredMass+(samples-explicit-observed)*0.20;
 const absolute=positive+negative;
 const conflict=absolute>0?2*Math.min(positive,negative)/absolute:0;
 return {mass,conflict,support:Math.min(1,mass/(mass+3)*(1-conflict/2)*(1+.5*preferenceSupport))};
}

/** The job streams distinct roots. Only feature totals and constant-size counters survive each page. */
export function createTasteAccumulator(ratings:RatingSummary={count:0,median:null},asOfMs=Date.now()){
 const totals=featureTotals<AffinityTotals>();
 const known=new Map<TasteDimension,DimensionTotals>(tasteDimensions.map(dimension=>[dimension,{inferredConsumed:0,inferredRepeated:0,explicitConsumed:0,explicitRepeated:0}]));
 const combinations=new Map<string,CombinationTotals>();
 let works=0,explicitWorks=0,inferredWorks=0,consumedWorks=0,repeatedWorks=0;
 return {
  add(evidence:TasteWorkEvidence,features:TasteFeatures,negativeWeight=1){
   works++;
   if(evidence.consumed)consumedWorks++;
   if(evidence.repeated)repeatedWorks++;
   if(evidence.rating===null&&!evidence.explicit&&!evidence.implicit&&!evidence.consumed&&!evidence.dropped)return;
   const strongReturn=!!evidence.deliberateReturn&&!evidence.dropped&&evidence.implicit>=0&&(evidence.rating===null||evidence.rating>=3);
   const vote=workVote(evidence,negativeWeight,strongReturn);
   // A dated watch is evidence of a choice, regardless of when a rating or favourite was imported.
   const experience=evidence.consumed?datedChoice(evidence.lastExperiencedAt,asOfMs,evidence.deliberateReturn||evidence.repeated?1:0,1):undefined;
   const ratingChoice=evidence.rating===null?undefined:datedChoice(evidence.lastRatedAt,asOfMs,
    ratingVote(evidence.rating,negativeWeight),ratingInfluence(evidence.rating)*(evidence.ratingReliability??1));
   const franchise=features.franchises?.reduce<string|undefined>((id,feature)=>!id||feature.id<id?feature.id:id,undefined);
   const observations={franchise,strongReturn,experience,ratingChoice,
    explicit:vote.explicit,weight:vote.weight,rating:evidence.rating,consumed:evidence.consumed,repeated:evidence.repeated,
    returned:evidence.consumed&&evidence.repeated&&evidence.implicit>=0&&!evidence.dropped,
    positiveFeedback:strongReturn||vote.value>=0&&(evidence.rating===null?evidence.explicit>0:evidence.rating>=3.5),
    opinion:evidence.dropped&&vote.value<0?false:strongReturn||evidence.rating!==null&&evidence.rating>=4||evidence.explicit>0&&evidence.rating===null?true
     :evidence.rating!==null&&evidence.rating<=2.5?false:null,
    completion:evidence.completion??null};
   if(!recordVote(totals,known,features,vote.value,observations))return;
   if(vote.explicit)explicitWorks++;
   else inferredWorks++;
   if(observations.consumed&&(!vote.explicit||vote.value>0||vote.value===0&&observations.returned)){
    for(const {key,left,right} of tasteCombinations(features)){
     let pair=combinations.get(key);
     if(!pair){
      const first=totals.get(left.dimension)?.get(left.id),second=totals.get(right.dimension)?.get(right.id);
      if(!first||!second)continue;
      pair={left:first,right:second,consumed:0,returned:0};
      combinations.set(key,pair);
     }
     pair.consumed++;
     if(observations.returned)pair.returned++;
    }
   }
  },
  // The caller groups child-only credits by canonical title and deduplicates each feature.
  addScopedRatings(groups:readonly {features:TasteFeatures;rating:number}[]){
   for(const {rating,features} of groups){
    const vote=ratingVote(rating);
    recordVote(totals,known,features,vote,{explicit:true,weight:ratingInfluence(rating),rating,
     consumed:false,repeated:false,returned:false,positiveFeedback:rating>=3.5,opinion:null,completion:null});
   }
  },
  returnWeights(){return combinationReturnWeights(combinations);},
  snapshot():LifetimeTasteProfile{
   const dimensions:LifetimeTasteProfile['dimensions']={},signals:LifetimeTasteProfile['signals']={};
   for(const [dimension,values] of totals){
    if(!values.size)continue;
    const people=personDimensions.has(dimension);
    const summaries:{
     entry:AffinityTotals;value:number;positive:number;negative:number;strength:number;creditPriority:number;preferenceSupport:number;
    }[]=[];
    const counts=known.get(dimension)!;
    for(const entry of values.values()){
     // Single-appearance credits never reach the saved profile or scoring reference.
     if(people&&entry.samples<2)continue;
     const preference=preferenceEvidence(entry,counts);
     const trend=recentPreference(entry.ratingTrend)??recentReturnPreference(entry.experienceTrend,counts.experienceTrend);
     const value=compact(Math.max(-.98,Math.min(.98,lifetimeAffinity(entry,dimension,consumedWorks,counts,preference.completion,preference.agreement)+trend)));
     const returned=value>0&&contextDimensions.has(dimension)?relativeRate(
      entry.inferredRepeatedSamples+entry.explicitRepeatedSamples,entry.inferredConsumedSamples+entry.explicitConsumedSamples,
      counts.inferredRepeated+counts.explicitRepeated,counts.inferredConsumed+counts.explicitConsumed):0;
     // For context, stated opinions take precedence over routine viewing as ratings accumulate.
     const behaviorWeight=contextDimensions.has(dimension)?8/((entry.outcomes?.decided??0)+8):1;
     const behaviorSupport=value>0?Math.max(preference.completion,returned)*behaviorWeight:0;
     // A title may back several measurements of the same preference. Use the strongest one.
     const preferenceSupport=compact(Math.max(0,
      behaviorSupport,Math.sign(value)*preference.opinion,Math.sign(value)*preference.majoritySupport));
     // Use the same reliability as the scoring reference to order the wall. Keep the
     // signed affinity itself intact, so a limited sample remains inspectable.
     const positive=compact(entry.positive),negative=compact(entry.negative);
     const {support}=affinityEvidence(entry.samples,entry.explicitSamples,entry.inferredConsumedSamples,positive,negative,entry.opinionWeight,preferenceSupport);
     summaries.push({entry,value,positive,negative,strength:Math.abs(value)*support*independentSupport(entry),
      creditPriority:people?creditSupport(entry,value):0,preferenceSupport});
    }
    const byValue=(a:typeof summaries[number],b:typeof summaries[number])=>
     Math.abs(b.value)-Math.abs(a.value)||b.entry.samples-a.entry.samples||a.entry.id.localeCompare(b.entry.id);
    const minimum=minimumAffinitySamples(dimension);
    const supported=({entry}:typeof summaries[number])=>Number(entry.samples-entry.neutralOnlySamples>=minimum);
    const entries=(people?summaries.sort((a,b)=>b.creditPriority-a.creditPriority||byValue(a,b))
     .slice(0,dimension==='cast'?512:256):summaries)
     .sort((a,b)=>supported(b)-supported(a)||b.strength-a.strength||byValue(a,b));
    if(!entries.length)continue;
    dimensions[dimension]=entries.map(({entry,value,positive,negative,preferenceSupport})=>{
     const saved:SavedAffinity=[entry.id,entry.name,value,entry.samples,positive,negative,
      entry.explicitSamples,entry.consumedSamples,entry.repeatedSamples,entry.positiveFeedbackSamples,entry.inferredConsumedSamples];
     const median=featureMedian(entry.ratings);
     const independence=independentSupport(entry);
     if(independence<1)saved.push(median??null,compact(entry.opinionWeight),entry.neutralOnlySamples,preferenceSupport,independence);
     else if(preferenceSupport)saved.push(median??null,compact(entry.opinionWeight),entry.neutralOnlySamples,preferenceSupport);
     else if(entry.opinionWeight!==entry.explicitSamples)
      saved.push(median??null,compact(entry.opinionWeight),entry.neutralOnlySamples);
     else if(median!==undefined)saved.push(median);
     return saved;
    });
    const preview=entries.slice(0,3).map(({entry:{name,samples},value})=>({name,value,samples}));
    signals[dimension]={count:entries.length,preview};
   }
   return {version:3,works,worksWithSignals:explicitWorks+inferredWorks,explicitWorks,inferredWorks,consumedWorks,repeatedWorks,
    ratings:ratings.count,medianRating:ratings.median,dimensions,signals};
  },
 };
}

export function decodeTasteAffinities(entries:TasteAffinity[]|SavedAffinity[]):TasteAffinity[]{
 return entries.map(entry=>{
  if(!Array.isArray(entry))return entry;
  const [id,name,value,samples,,,explicitSamples,consumedSamples,repeatedSamples,positiveFeedbackSamples,,medianRating]=entry;
  return {id,name,value,samples,explicitSamples,consumedSamples,repeatedSamples,positiveFeedbackSamples,medianRating:medianRating??undefined};
 });
}

const influence:Record<TasteDimension,number> = {
 genres:1.25,tags:1.2,themes:1.15,cast:1.0,directors:0.92,writers:0.92,illustrators:0.78,composers:0.08,cinematographers:0.55,franchises:0.85,
 developers:0.85,publishers:0.25,mechanics:0.3,perspectives:0.35,artists:0.9,studios:0.48,networks:0.48,languages:0.12,countries:0.16,decades:0.24,ageRatings:0.20,
};
type Direction='positive'|'negative'|'mixed';
// Fixed positions keep the persisted lookup small. Only comparable features get an entry.
type ScoringAffinity=[name:string,value:number,samples:number,explicit:number,mass:number,support:number,direction:Direction,opinionWeight?:number];
export type TasteReference={
 works:number;
 dimensions:Partial<Record<TasteDimension,Record<string,ScoringAffinity>>>;
 ratingWeights?:Record<string,number>;
 returnWeights?:Record<string,number>;
 selection?: TasteSelection;
 creators?: CreatorPreferences;
};
type TasteReason={dimension:TasteDimension;name:string;direction:Direction;samples:number};
type SignalEvidence=Omit<TasteReason,'dimension'>&{explicit:number;affinity:number;support:number;creator?:{liked:number;rated:number;independent:number}};
export type TasteSignalBreakdown={dimension:TasteDimension;context:boolean;fit:number;matched:number;compared:number;weightShare:number;evidence:SignalEvidence[]};
export type TasteScoreBreakdown={
 signals:TasteSignalBreakdown[];
 coverage:number;
 support:number;
 friends?:FriendTasteAdjustment;
 selection?: TasteSelectionBreakdown;
 calculation?:{rawScore:number;baseScore:number;ratingAdjustment:number;ratingTerms:TasteRatingTerm[];retained:number;explicit:number;ageRatingPoints?:number};
 withheld?:'context'|'support';
};
type TasteFit={score:number|null;confidence:number;dimensions:Partial<Record<TasteDimension,number>>;reasons:TasteReason[];matches:number;ratingAdjustment?:number;returnTieBreak?:number;breakdown?:TasteScoreBreakdown};

/** The worker prepares all title-independent weights before publishing the owner's reference. */
export function prepareTasteReference(profile:SavedTasteProfile,ratingWeights?:TasteReference['ratingWeights'],returnWeights?:TasteReference['returnWeights']):TasteReference{
 const dimensions:TasteReference['dimensions']={};
 for(const dimension of tasteDimensions){
  const entries=profile.dimensions[dimension];
  if(!entries?.length)continue;
  const lookup:Record<string,ScoringAffinity>=Object.create(null);
  for(const entry of entries){
   let id:string,name:string,value:number,samples:number,explicit:number,observed:number,positive=0,negative=0,opinionWeight=0,neutralOnly=0,preferenceSupport=0;
   if(Array.isArray(entry)){
    [id,name,value,samples,positive,negative,explicit]=entry;
    observed=entry[10];
    opinionWeight=entry[12]??explicit;
    neutralOnly=entry[13]??0;
    preferenceSupport=entry[14]??0;
   }else{
    // Previously published profiles contain signed affinities without evidence provenance.
    ({id,name,value,samples}=entry);
    explicit=0;observed=samples;
   }
   const scoredSamples=samples-neutralOnly;
   if(scoredSamples<minimumAffinitySamples(dimension))continue;
   const {mass,support,conflict}=affinityEvidence(samples,explicit,observed,positive,negative,opinionWeight,preferenceSupport);
   const independence=Array.isArray(entry)?entry[15]??1:1;
   const reliability=support*independence*(contextDimensions.has(dimension)?0.3+0.7*preferenceSupport:1);
   const mixed=conflict>=0.75&&Math.abs(value)<0.15;
   const direction=mixed||Math.abs(value)<0.04?'mixed':value<0?'negative':'positive';
   const scoredExplicit=explicit-neutralOnly;
   const affinity:ScoringAffinity=[name,value,scoredSamples,scoredExplicit,mass,reliability,direction];
   if(opinionWeight!==scoredExplicit)affinity.push(opinionWeight);
   lookup[id]=affinity;
   dimensions[dimension]=lookup;
  }
 }
 return {works:profile.works,dimensions,...(ratingWeights?{ratingWeights}:{}),...(returnWeights?{returnWeights}:{})};
}

/** JSONB key order is immaterial. Evaluate genres before their descriptive aliases on every read. */
export function scorerFromReference(reference:TasteReference,inspect=false){
 return (features:TasteFeatures):TasteFit=>{
  const dimensions:TasteFit['dimensions']={},reasons:(TasteReason&{strength:number})[]=[];
  const signals: (Omit<TasteSignalBreakdown,'weightShare'>&{weight:number})[]|undefined=inspect?[]:undefined;
  let contextWeight=0,contextTotal=0,signalWeight=0,signalTotal=0,matches=0,descriptiveWeight=0;
  let strongestMass=0,direct=0,opinionWeight=0,availableDimensions=0,matchedDimensions=0;
  // One person credited in multiple roles can have a distinct affinity in each. Split their
  // support across the matching roles so they cannot accumulate independent corroboration.
  const roles=new Map<string,number>();
  for(const dimension of personDimensions){
   const lookup=reference.dimensions[dimension],people=features[dimension];
   if(!lookup||!people?.length)continue;
   for(const id of new Set(people.map(person=>person.id))){
    if(Object.hasOwn(lookup,id))roles.set(id,(roles.get(id)??0)+1);
   }
  }
  const matchedConcepts=new Set<string>();
  for(const dimension of tasteDimensions){
   const lookup=reference.dimensions[dimension],candidates=features[dimension];
   if(!lookup||!candidates?.length)continue;
   const descriptive=isDescriptiveTasteDimension(dimension);
   const contextual=contextDimensions.has(dimension)||(dimension==='artists'&&candidates.every(feature=>
    feature.id.startsWith('artist-name:')||!Object.hasOwn(lookup,feature.id)));
   // Verified credits can corroborate metadata coverage, even with a low score priority.
   const countsForCoverage=!contextual||(dimension!=='artists'&&personDimensions.has(dimension));
   const seen=new Set<string>();
   const evidence: (SignalEvidence&{strength:number})[]|undefined=inspect?[]:undefined;
   let support=0,numerator=0,strongestSupport=0,strongestContribution=0,creatorWeight=0,known=0,compared=0;
   let best:TasteReason|undefined,bestStrength=-1;
   for(const feature of candidates){
    if(seen.has(feature.id))continue;
    seen.add(feature.id);
    const concept=descriptive?feature.name.trim().toLocaleLowerCase('en-US'):undefined;
    if(concept!==undefined&&matchedConcepts.has(concept))continue;
    compared++;
    if(!Object.hasOwn(lookup,feature.id))continue;
    // A name-only credit may be a namesake. Once a verified artist matches, use the
    // verified identities for this dimension and leave unresolved credits in its coverage.
    if(dimension==='artists'&&!contextual&&feature.id.startsWith('artist-name:'))continue;
    const [name,value,samples,explicit,mass,featureSupport,direction,featureOpinionWeight=explicit]=lookup[feature.id];
    if(concept!==undefined)matchedConcepts.add(concept);
    known++;
    if(!contextual){
     strongestMass=Math.max(strongestMass,mass);direct=Math.max(direct,explicit);
     opinionWeight=Math.max(opinionWeight,featureOpinionWeight);
    }
    const rolesForPerson=personDimensions.has(dimension)?roles.get(feature.id)??1:1;
    let reliability=featureSupport/rolesForPerson;
    if(dimension==='artists'&&feature.id.startsWith('artist-name:'))reliability*=0.35;
    const baseReliability=reliability;
    strongestSupport=Math.max(strongestSupport,reliability);
    const pattern=value>0&&(dimension==='directors'||dimension==='writers')?
     applicableCreatorPattern(reference.creators,dimension,feature.id,features):undefined;
    if(pattern){
     const extra=1.8*pattern.strength*reliability;
     creatorWeight=Math.max(creatorWeight,extra);
     reliability+=extra;
    }
    support+=reliability;
    numerator+=value*reliability;
    strongestContribution=Math.max(strongestContribution,reliability);
    const strength=Math.abs(value)*reliability;
    evidence?.push({name,direction,samples,explicit,affinity:Math.round(50+50*value),support:baseReliability,strength,
     ...(pattern?{creator:{liked:pattern.liked,rated:pattern.rated,independent:pattern.independent}}:{})});
    if(strength>bestStrength||strength===bestStrength&&best&&name<best.name){
     best={dimension,name,direction,samples};bestStrength=strength;
    }
   }
   if(countsForCoverage){
    if(compared)availableDimensions++;
    if(known)matchedDimensions++;
   }
   if(!known)continue;
   const fit=numerator/support;
   // Unknown credits lower evidence coverage but carry no negative preference.
   const coverage=0.5+0.5*Math.sqrt(Math.min(1,known/Math.min(8,compared)));
   const supportedWeight=influence[dimension]*strongestSupport*coverage;
   // A demonstrated creator preference can carry more weight than a broad genre.
   const ordinaryWeight=descriptive||!descriptiveWeight?supportedWeight:Math.min(supportedWeight,0.85*descriptiveWeight);
   const weight=ordinaryWeight+influence[dimension]*coverage*creatorWeight;
   if(descriptive)descriptiveWeight=Math.max(descriptiveWeight,weight);
   if(contextual){
    contextWeight+=weight;contextTotal+=fit*weight;
   }else{
    signalWeight+=weight;signalTotal+=fit*weight;
   }
   matches+=known;
   dimensions[dimension]=Math.round(50+50*fit);
   if(evidence)signals?.push({dimension,context:contextual,fit:dimensions[dimension]!,matched:known,compared,weight,
    evidence:evidence.sort((a,b)=>b.strength-a.strength||a.name.localeCompare(b.name)).slice(0,5).map(({strength,...entry})=>entry)});
   if(best)reasons.push({...best,strength:bestStrength*weight/strongestContribution});
  }
  // Correlated context such as language and country corroborates the primary evidence.
  const contextUsed=Math.min(0.55,contextWeight,signalWeight?0.75*signalWeight:Infinity);
  const weight=signalWeight+contextUsed;
  const coverage=availableDimensions?0.65+0.35*Math.sqrt(matchedDimensions/availableDimensions):1;
  const breakdown:TasteScoreBreakdown|undefined=signals&&{coverage,support:weight*coverage,
   signals:signals.map(({weight:rawWeight,...signal})=>({...signal,
    weightShare:weight?(signal.context?rawWeight*contextUsed/contextWeight:rawWeight)/weight:0,
   })).sort((a,b)=>b.weightShare-a.weightShare)};
  if(weight*coverage<0.35||!signalWeight){
   // An established choice pattern can speak on its own, but says little about enjoyment.
   const details:TasteSelectionBreakdown[]|undefined=breakdown?[]:undefined;
   const selection=tasteSelectionAdjustment(reference.selection,features,50,details,true);
   if(selection<=-12){
    const points=Math.round(selection*.45);
    if(breakdown){
     breakdown.selection={...details![0],points,choiceOnly:true};
     breakdown.calculation={rawScore:50,baseScore:50,retained:0,explicit:0,ratingAdjustment:0,ratingTerms:[]};
    }
    return {score:50+points,confidence:Math.round(-selection*.75),dimensions:{},reasons:[],matches,...(breakdown?{breakdown}:{})};
   }
   if(breakdown)breakdown.withheld=!signalWeight?'context':'support';
   return {score:null,confidence:0,dimensions:{},reasons:[],matches,...(breakdown?{breakdown}:{})};
  }
  const total=signalTotal+(contextWeight?contextTotal*contextUsed/contextWeight:0);
  // Ten matching fields on the same two films are still evidence from two films.
  const smallProfileRetention=Math.min(weight/(weight+0.4),strongestMass/(strongestMass+1.5));
  const sourceLimit=0.65+0.35*opinionWeight/(opinionWeight+4);
  const evidenceSupport=coverage*Math.min(weight/(weight+0.8),strongestMass/(strongestMass+4),sourceLimit);
  // Preserve the first two opinions. Move gradually to measured evidence coverage as
  // the medium fills out, applying one retention factor before the nonlinear fit.
  const maturity=Math.max(0,Math.min(1,(reference.works-2)/38));
  const retention=smallProfileRetention+(evidenceSupport-smallProfileRetention)*maturity;
  // Widen supported fits in either direction while preserving room between strong matches.
  const gain=0.85+0.95*opinionWeight/(opinionWeight+5);
  const baseScore=Math.round(50+50*Math.tanh(gain*total/weight*retention));
  const ratingTerms:TasteRatingTerm[]|undefined=breakdown?[]:undefined;
  const fittedScore=Math.max(0,Math.min(100,baseScore+tasteRatingAdjustment(reference.ratingWeights,features,ratingTerms)));
  const selectionDetail:TasteSelectionBreakdown[]|undefined=breakdown&&reference.selection?[]:undefined;
  const score=fittedScore+tasteSelectionAdjustment(reference.selection,features,fittedScore,selectionDetail);
  const returnTieBreak=tasteReturnTieBreak(reference.returnWeights,features);
  const evidenceConfidence=100*evidenceSupport;
  const choiceReliance=Math.min(1,(fittedScore-score)/50);
  const confidence=Math.round(evidenceConfidence-choiceReliance*Math.max(0,evidenceConfidence-55));
  const names=new Set<string>();
  const distinct=reasons.sort((a,b)=>b.strength-a.strength||a.name.localeCompare(b.name)).filter(({name})=>{
   if(names.has(name))return false;
   names.add(name);
   return true;
  });
  const selected=distinct.slice(0,3);
  const strongest=selected[0];
  if(strongest&&strongest.direction!=='mixed'){
   const opposing=strongest.direction==='positive'?'negative':'positive';
   if(!selected.some(reason=>reason.direction===opposing)){
    const counterpoint=distinct.find(reason=>reason.direction===opposing&&reason.samples>=3&&
     reason.strength>=Math.max(0.08,strongest.strength/3));
    if(counterpoint)selected[selected.length-1]=counterpoint;
   }
  }
  const explanations=selected.map(({dimension,name,direction,samples})=>({dimension,name,direction,samples}));
  const adjustment=fittedScore-baseScore;
  if(breakdown){
   if(selectionDetail?.length)breakdown.selection=selectionDetail[0];
   const withoutAgeRating=dimensions.ageRatings===undefined?null:scorerFromReference(reference)({...features,ageRatings:undefined}).score;
   breakdown.calculation={rawScore:Math.round(50+50*Math.tanh(gain*total/weight)),baseScore,
   ratingAdjustment:adjustment,retained:retention,explicit:direct,
   ratingTerms:ratingTerms!.sort((a,b)=>Math.abs(b.points)-Math.abs(a.points)||a.name.localeCompare(b.name)).slice(0,5),
   ...(withoutAgeRating===null?{}:{ageRatingPoints:score-withoutAgeRating})};
  }
  return {score,confidence,dimensions,matches,reasons:explanations,...(adjustment?{ratingAdjustment:adjustment}:{}),
   ...(returnTieBreak?{returnTieBreak}:{}),...(breakdown?{breakdown}:{})};
 };
}

export function compileTasteScorer(profile:SavedTasteProfile){return scorerFromReference(prepareTasteReference(profile));}

export function scoreTaste(profile:SavedTasteProfile,features:TasteFeatures){return compileTasteScorer(profile)(features);}
