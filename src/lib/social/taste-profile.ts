export const tasteMedia = [
 {value:'movie',comparison:'movies',label:'Movies',category:'screen'},
 {value:'show',comparison:'tv',label:'Shows',category:'screen'},
 {value:'music',comparison:'music',label:'Music',category:'music'},
 {value:'game',comparison:'game',label:'Games',category:'game'},
 {value:'book',comparison:'book',label:'Books',category:'book'},
 {value:'comic',comparison:'comic',label:'Comics',category:'comic'},
] as const;
export type TasteMedium = typeof tasteMedia[number]['value'];
export const tasteDimensions = ['genres','tags','themes','cast','directors','writers','illustrators','composers','cinematographers','franchises','developers','publishers','mechanics','perspectives','artists','studios','networks','languages','countries','decades'] as const;
export type TasteDimension = typeof tasteDimensions[number];
export type TasteFeature = {id:string;name:string};
export type TasteFeatures = Partial<Record<TasteDimension,TasteFeature[]>>;
export type TasteEvidence = {id:string;weight:number;features:TasteFeatures};
export type TasteAffinity = TasteFeature & {
 value:number;samples:number;explicitSamples?:number;consumedSamples?:number;repeatedSamples?:number;positiveFeedbackSamples?:number;
};
export type TasteProfile = {version:1;works:number;dimensions:Partial<Record<TasteDimension,TasteAffinity[]>>};
export type TasteWorkEvidence = {rating:number|null;explicit:number;implicit:number;consumed:boolean;repeated:boolean;playtimeRank?:number|null};
export type SavedAffinity = [id:string,name:string,value:number,samples:number,positive:number,negative:number,explicitSamples:number,
 consumedSamples:number,repeatedSamples:number,positiveFeedbackSamples:number,inferredConsumedSamples:number];
type SignalPreview = Pick<TasteAffinity,'name'|'value'|'samples'>;
export type LifetimeTasteProfile = {
 version:3;works:number;worksWithSignals:number;explicitWorks:number;inferredWorks:number;consumedWorks:number;repeatedWorks:number;ratings:number;medianRating:number|null;
 genreEvidence:DimensionCounts;
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

type AffinityTotals = TasteFeature & {
 positive:number;negative:number;samples:number;explicitSamples:number;consumedSamples:number;repeatedSamples:number;
 positiveFeedbackSamples:number;explicitTotal:number;inferredConsumedSamples:number;inferredRepeatedSamples:number;
};
type DimensionCounts = {consumed:number;repeated:number;explicit:number;positive:number};
type DimensionTotals = DimensionCounts & {inferredConsumed:number;inferredRepeated:number};
type Observations = {explicit:boolean;consumed:boolean;repeated:boolean;positiveFeedback:boolean};
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

function recordVote(totals:Map<TasteDimension,Map<string,AffinityTotals>>,known:Map<TasteDimension,DimensionTotals>,features:TasteFeatures,vote:number,observations:Observations){
 return visitFeatures(features,(dimension,{id,name})=>{
  const values=totals.get(dimension)!;
  let entry=values.get(id);
  if(!entry){
   entry={id,name,positive:0,negative:0,samples:0,explicitSamples:0,consumedSamples:0,repeatedSamples:0,positiveFeedbackSamples:0,explicitTotal:0,inferredConsumedSamples:0,inferredRepeatedSamples:0};
   values.set(id,entry);
  }
  entry.positive+=Math.max(0,vote);
  entry.negative+=Math.max(0,-vote);
  entry.samples++;
  if(observations.explicit){entry.explicitSamples++;entry.explicitTotal+=vote;}
  else if(observations.consumed){
   entry.inferredConsumedSamples++;
   if(observations.repeated)entry.inferredRepeatedSamples++;
  }
  if(observations.consumed)entry.consumedSamples++;
  if(observations.repeated)entry.repeatedSamples++;
  if(observations.positiveFeedback)entry.positiveFeedbackSamples++;
 },dimension=>{
  const counts=known.get(dimension)!;
  if(observations.consumed)counts.consumed++;
  if(observations.repeated)counts.repeated++;
  if(observations.explicit)counts.explicit++;
  else if(observations.consumed){
   counts.inferredConsumed++;
   if(observations.repeated)counts.inferredRepeated++;
  }
  if(observations.positiveFeedback)counts.positive++;
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

type RatingBaseline = {count:number;median:number|null};
// A handful of ratings gives little evidence of a personal scale. Even a well-established
// scale shifts the midpoint by at most three quarters of a star. Endpoints stay anchored.
function ratingMidpoint({count,median}:RatingBaseline){
 const midpoint=2.75;
 if(median===null||count<5)return midpoint;
 const calibration=Math.min(1,(count-4)/12);
 return midpoint+calibration*Math.max(-0.75,Math.min(0.75,median-midpoint));
}

const inferredMass=0.5;
// Repeat evidence has its own count. A completion contributes the same base vote on later plays.
const inferredPreference=[0,0.10,0.18,0.34,0.34] as const;
function workVote({rating,explicit,implicit,consumed,playtimeRank}:TasteWorkEvidence,midpoint:number){
 if(rating!==null){
  const distance=rating-midpoint;
  return {value:Math.max(-1,Math.min(1,distance/(distance>=0?5-midpoint:midpoint-0.5))),explicit:true};
 }
 if(explicit)return {value:Math.max(-1,Math.min(1,explicit/5)),explicit:true};
 // A drop can mean abandoning a tracker entry; consumption alone gives limited evidence of liking.
 const preference=implicit<0?-0.30:inferredPreference[Math.min(4,Math.max(0,implicit))];
 // Lifetime playtime measures exposure. Give above-usual play a small bonus only, since the
 // length of a game is unknown and a short completed game can be just as much a favourite.
 const duration=consumed&&implicit>0?0.12*Math.max(0,Math.min(1,playtimeRank??0)):0;
 return {value:(preference+duration)*inferredMass,explicit:false};
}

const compact=(value:number)=>Math.round(value*10000)/10000;
const contextDimensions=new Set<TasteDimension>(['genres','publishers','mechanics','perspectives','studios','networks','languages','countries','decades']);

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

/** Combine observed reach, deliberate returns and the user's stated opinions once per feature. */
function lifetimeAffinity(entry:AffinityTotals,dimension:TasteDimension,consumedWorks:number,known:DimensionTotals){
 const inferred=entry.samples-entry.explicitSamples;
 const base=inferred?(entry.positive-entry.negative-entry.explicitTotal)/(inferred*inferredMass+2):0;
 // An explicitly assessed work has already spent its vote. Its watch or replay remains visible
 // in history but cannot also supply the behavioural prior used to smooth that very assessment.
 const consumed=entry.inferredConsumedSamples;
 const reach=consumed/Math.max(1,consumedWorks);
 const replayRate=entry.inferredRepeatedSamples/Math.max(1,consumed);
 const selectiveReturns=entry.inferredRepeatedSamples
  ?Math.max(0,relativeRate(entry.inferredRepeatedSamples,consumed,known.inferredRepeated,known.inferredConsumed)):0;
 const replay=(replayRate+selectiveReturns)/2;
 // Frequency of a language, country or studio is largely a property of the available catalogue.
 let frequencyWeight=1;
 if(dimension==='genres')frequencyWeight=0.70;
 else if(contextDimensions.has(dimension))frequencyWeight=0.25;
 else if(dimension==='tags'||dimension==='themes')frequencyWeight=0.50;
 const exposure=frequencyWeight*consumed/(consumed+4)*(0.65*reach+0.20*replay);
 const behaviour=Math.min(1,base+(base<0?0:exposure));
 // Repeated stated opinions outweigh incidental exposure however often a feature appears.
 // The prior contains two works' worth of behavioural evidence, or neutral with no observations.
 return compact((entry.explicitTotal+2*behaviour)/(entry.explicitSamples+2));
}

/** The job streams distinct roots. Only feature totals and constant-size counters survive each page. */
export function createTasteAccumulator(baseline:RatingBaseline={count:0,median:null}){
 const totals=featureTotals<AffinityTotals>(),midpoint=ratingMidpoint(baseline);
 const known=new Map(tasteDimensions.map(dimension=>[dimension,{consumed:0,repeated:0,explicit:0,positive:0,inferredConsumed:0,inferredRepeated:0}]));
 let works=0,explicitWorks=0,inferredWorks=0,consumedWorks=0,repeatedWorks=0;
 return {
  add(evidence:TasteWorkEvidence,features:TasteFeatures){
   works++;
   if(evidence.consumed)consumedWorks++;
   if(evidence.repeated)repeatedWorks++;
   if(evidence.rating===null&&!evidence.explicit&&!evidence.implicit&&!evidence.consumed)return;
   const vote=workVote(evidence,midpoint);
   const observations={explicit:vote.explicit,consumed:evidence.consumed,repeated:evidence.repeated,
    positiveFeedback:evidence.rating===null?evidence.explicit>0:evidence.rating>=3.5};
   if(!recordVote(totals,known,features,vote.value,observations))return;
   if(vote.explicit)explicitWorks++;
   else inferredWorks++;
  },
  snapshot():LifetimeTasteProfile{
   const dimensions:LifetimeTasteProfile['dimensions']={},signals:LifetimeTasteProfile['signals']={};
   for(const [dimension,values] of totals){
    if(!values.size)continue;
    const entries=Array.from(values.values(),entry=>({...entry,value:lifetimeAffinity(entry,dimension,consumedWorks,known.get(dimension)!)})).sort(byAffinity);
    dimensions[dimension]=entries.map(entry=>[entry.id,entry.name,entry.value,entry.samples,compact(entry.positive),compact(entry.negative),
     entry.explicitSamples,entry.consumedSamples,entry.repeatedSamples,entry.positiveFeedbackSamples,entry.inferredConsumedSamples]);
    const preview=entries.slice(0,3).map(({name,value,samples})=>({name,value,samples}));
    signals[dimension]={count:entries.length,preview};
   }
   const {consumed,repeated,explicit,positive}=known.get('genres')!;
   return {version:3,works,worksWithSignals:explicitWorks+inferredWorks,explicitWorks,inferredWorks,consumedWorks,repeatedWorks,
    ratings:baseline.count,medianRating:baseline.median,genreEvidence:{consumed,repeated,explicit,positive},dimensions,signals};
  },
 };
}

export function decodeTasteAffinities(entries:TasteAffinity[]|SavedAffinity[]):TasteAffinity[]{
 return entries.map(entry=>{
  if(!Array.isArray(entry))return entry;
  const [id,name,value,samples,,,explicitSamples,consumedSamples,repeatedSamples,positiveFeedbackSamples]=entry;
  return {id,name,value,samples,explicitSamples,consumedSamples,repeatedSamples,positiveFeedbackSamples};
 });
}

const influence:Record<TasteDimension,number> = {
 genres:0.65,tags:0.9,themes:0.95,cast:0.9,directors:1.1,writers:1.1,illustrators:1,composers:0.9,cinematographers:0.85,franchises:1,
 developers:1,publishers:0.25,mechanics:0.3,perspectives:0.35,artists:1.15,studios:0.35,networks:0.25,languages:0.2,countries:0.2,decades:0.25,
};
const personDimensions:ReadonlySet<TasteDimension>=new Set(['cast','directors','writers','illustrators','composers','cinematographers','artists']);
type Direction='positive'|'negative'|'mixed';
// Fixed positions keep the persisted lookup small. Only comparable features get an entry.
type ScoringAffinity=[name:string,value:number,samples:number,explicit:number,mass:number,support:number,direction:Direction,distinctiveGenre?:true];
export type TasteReference={
 works:number;
 dimensions:Partial<Record<TasteDimension,Record<string,ScoringAffinity>>>;
 genres:Record<string,true>;
};
type TasteReason={dimension:TasteDimension;name:string;direction:Direction;samples:number};
type TasteFit={score:number|null;confidence:number;dimensions:Partial<Record<TasteDimension,number>>;reasons:TasteReason[];matches:number};

/** The worker prepares all title-independent weights before publishing the owner's reference. */
export function prepareTasteReference(profile:SavedTasteProfile):TasteReference{
 const dimensions:TasteReference['dimensions']={};
 const genres:Record<string,true>=Object.create(null);
 for(const dimension of tasteDimensions){
  const entries=profile.dimensions[dimension];
  if(!entries?.length)continue;
  const lookup:Record<string,ScoringAffinity>=Object.create(null);
  for(const entry of entries){
   let id:string,name:string,value:number,samples:number,explicit:number,observed:number,mixed=false,conflict=0,distinctiveGenre=false;
   if(Array.isArray(entry)){
    let positive:number,negative:number;
    [id,name,value,samples,positive,negative,explicit]=entry;
    observed=entry[10];
    if(dimension==='genres'&&profile.version===3&&profile.genreEvidence&&samples>=2){
     const known=profile.genreEvidence;
     const endorsed=explicit>=2?relativeRate(entry[9],explicit,known.positive,known.explicit):0;
     // Not replaying is not a rejection. Only above-usual returns corroborate positive sentiment.
     distinctiveGenre=endorsed*value>0||(value>0&&entry[8]>0&&relativeRate(entry[8],entry[7],known.repeated,known.consumed)>0);
    }
    const absolute=positive+negative;
    conflict=absolute>0?2*Math.min(positive,negative)/absolute:0;
    mixed=conflict>=0.75&&Math.abs(value)<0.15;
   }else{
    // Previously published profiles contain signed affinities without evidence provenance.
    ({id,name,value,samples}=entry);
    explicit=0;observed=samples;
   }
   if(dimension==='genres')genres[name.trim().toLocaleLowerCase('en-US')]=true;
   if(samples<2)continue;
   const inferred=samples-explicit;
   const mass=explicit+observed*inferredMass+(inferred-observed)*0.20;
   const support=mass/(mass+3)*(1-conflict/2);
   const direction=mixed||Math.abs(value)<0.04?'mixed':value<0?'negative':'positive';
   const affinity:ScoringAffinity=[name,value,samples,explicit,mass,support,direction];
   if(distinctiveGenre)affinity[7]=true;
   lookup[id]=affinity;
   dimensions[dimension]=lookup;
  }
 }
 return {works:profile.works,dimensions,genres};
}

/** JSONB key order is immaterial. Evaluate genres before their descriptive aliases on every read. */
export function scorerFromReference(reference:TasteReference){
 return (features:TasteFeatures):TasteFit=>{
  const dimensions:TasteFit['dimensions']={},reasons:(TasteReason&{strength:number})[]=[];
  let contextWeight=0,contextTotal=0,signalWeight=0,signalTotal=0,matches=0,informativeGenres=0,distinctiveGenre=false;
  let signalMass=0,genreMass=0,explicitSamples=0,genreExplicit=0,availableDimensions=0,matchedDimensions=0;
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
   const descriptive=dimension==='genres'||dimension==='tags'||dimension==='themes';
   const contextual=contextDimensions.has(dimension)||(dimension==='artists'&&candidates.every(feature=>
    feature.id.startsWith('artist-name:')||!Object.hasOwn(lookup,feature.id)));
   if(!contextual)availableDimensions++;
   const seen=new Set<string>();
   let support=0,numerator=0,strongestSupport=0,known=0;
   let best:TasteReason|undefined,bestStrength=-1;
   for(const feature of candidates){
    if(seen.has(feature.id))continue;
    seen.add(feature.id);
    if(!Object.hasOwn(lookup,feature.id))continue;
    // A name-only credit may be a namesake. Once a verified artist matches, use the
    // verified identities for this dimension and leave unresolved credits in its coverage.
    if(dimension==='artists'&&!contextual&&feature.id.startsWith('artist-name:'))continue;
    const [name,value,samples,explicit,mass,featureSupport,direction,distinctive]=lookup[feature.id];
    if(descriptive){
     const concept=name.trim().toLocaleLowerCase('en-US');
     if((dimension!=='genres'&&Object.hasOwn(reference.genres,concept))||matchedConcepts.has(concept))continue;
     matchedConcepts.add(concept);
    }
    known++;
    if(!contextual){
     signalMass=Math.max(signalMass,mass);explicitSamples=Math.max(explicitSamples,explicit);
    }
    if(dimension==='genres'){
     distinctiveGenre||=distinctive===true;
     genreMass=Math.max(genreMass,mass);genreExplicit=Math.max(genreExplicit,explicit);
    }
    const rolesForPerson=personDimensions.has(dimension)?roles.get(feature.id)??1:1;
    let reliability=featureSupport/rolesForPerson;
    if(dimension==='artists'&&feature.id.startsWith('artist-name:'))reliability*=0.35;
    support+=reliability;
    numerator+=value*reliability;
    strongestSupport=Math.max(strongestSupport,reliability);
    const strength=Math.abs(value)*reliability;
    if(strength>bestStrength||strength===bestStrength&&best&&name<best.name){
     best={dimension,name,direction,samples};bestStrength=strength;
    }
   }
   if(!known)continue;
   const fit=numerator/support;
   // Unknown credits lower evidence coverage but carry no negative preference.
   const coverage=0.5+0.5*Math.sqrt(Math.min(1,known/Math.min(8,seen.size)));
   const weight=influence[dimension]*strongestSupport*coverage;
   if(contextual){
    contextWeight+=weight;contextTotal+=fit*weight;
    if(dimension==='genres')informativeGenres=known;
   }else{
    matchedDimensions++;signalWeight+=weight;signalTotal+=fit*weight;
   }
   matches+=known;
   dimensions[dimension]=Math.round(50+50*fit);
   if(best)reasons.push({...best,strength:bestStrength*influence[dimension]});
  }
  // Many weak contextual attributes must not outweigh a creator, subject or franchise.
  // A single genre can stand alone only when endorsements or deliberate returns distinguish it from
  // other known genres. Correlated context such as language and country cannot unlock a fit.
  const hasGenreSignal=informativeGenres>=2||distinctiveGenre;
  const contextLimit=hasGenreSignal?0.65:0.35;
  const contextUsed=Math.min(contextLimit,contextWeight);
  const weight=signalWeight+contextUsed;
  const coverage=availableDimensions?0.65+0.35*Math.sqrt(matchedDimensions/availableDimensions):1;
  if(weight*coverage<0.35||(!signalWeight&&!hasGenreSignal))return {score:null,confidence:0,dimensions:{},reasons:[],matches};
  const total=signalTotal+(contextWeight?contextTotal*contextUsed/contextWeight:0);
  // Evidence strength, not a calibrated probability of liking. Shrink thin matches toward neutral.
  // Ten fields on the same two films are still evidence from two films.
  const strongestMass=signalWeight?signalMass:genreMass;
  const shrink=Math.min(weight/(weight+0.4),strongestMass/(strongestMass+1.5));
  const score=Math.round(50+50*total/weight*shrink);
  const direct=signalWeight?explicitSamples:genreExplicit;
  const sourceLimit=0.65+0.35*direct/(direct+4);
  const confidence=Math.round(100*coverage*Math.min(weight/(weight+0.8),strongestMass/(strongestMass+4),sourceLimit));
  const names=new Set<string>(),explanations:TasteReason[]=[];
  for(const {dimension,name,direction,samples} of reasons.sort((a,b)=>b.strength-a.strength||a.name.localeCompare(b.name))){
   if(names.has(name))continue;
   names.add(name);explanations.push({dimension,name,direction,samples});
   if(explanations.length===3)break;
  }
  return {score,confidence,dimensions,matches,reasons:explanations};
 };
}

export function compileTasteScorer(profile:SavedTasteProfile){return scorerFromReference(prepareTasteReference(profile));}

export function scoreTaste(profile:SavedTasteProfile,features:TasteFeatures){return compileTasteScorer(profile)(features);}
