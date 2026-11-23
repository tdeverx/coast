// Personal matching model, trained independently for each viewer and medium. The artifact contains only JSON data.
// Each input represents one canonical work. Neither fitting nor prediction performs I/O.
import {createTasteAccumulator, prepareTasteReference, scorerFromReference, tasteDimensionsByMedium, type TasteMedium, type TasteDimension, type TasteFeature, type TasteFeatures, type TasteReference} from './taste-profile';
import {applyTasteV2Display, fitTasteV2Display, tasteV2DisplayFolds, tasteV2DisplayFoldCount, type TasteV2Display, type DisplayPoint} from './taste-v2-display';
import {asFit, fitOrderedRatings, fromStars, orderedValue, type OrderedModel, type OrderedObservation} from './taste-v2-ordinal';
import type {TasteObservation} from './taste-training';

export const tasteV2Version = 1 as const;
export type TasteV2Medium = 'movie' | 'show';
export type TasteV2Dimension = TasteDimension | 'creators';
export type TasteV2Features = TasteFeatures & {creators?: TasteFeature[]};
export type TasteV2Observation = Omit<TasteObservation, 'features'> & {features: TasteV2Features};
export type TasteV2Stage = 'baseline' | 'ordinal' | 'metadata' | 'actions' | 'combined' | 'context' | 'personal' | 'contrast' | 'balanced' | 'calibrated';
export type TasteV2Options = {
  stage?: TasteV2Stage;
  dimensions?: readonly TasteV2Dimension[];
  excludeRoot?: string;
  asOf?: number;
  ordinal?: boolean;
  habits?: boolean;
  contextEvidence?: boolean;
  catalogue?: TasteV2Catalogue;
};

const screenWeights = {
  genres: 1, tags: .95, themes: .85, directors: .7, writers: .65, creators: .7, cast: .6,
  franchises: .75, studios: .45, networks: .45, decades: .20, ageRatings: .20, languages: .15,
  countries: .15, composers: .20, cinematographers: .15,
} satisfies Partial<Record<TasteV2Dimension, number>>;
const weights = {...screenWeights, artists:.75, developers:.7, illustrators:.65, publishers:.45, mechanics:.85, perspectives:.45};
type Family = keyof typeof weights;
const screenFamilies = Object.keys(screenWeights) as Family[];
export function personalDimensionsFor(medium:TasteMedium):readonly Family[] {
  return medium==='movie' || medium==='show' ? screenFamilies : tasteDimensionsByMedium[medium];
}
const descriptive = new Set<Family>(['genres', 'tags', 'themes']);
const specific = new Set<Family>(['studios', 'networks', 'creators', 'directors', 'writers', 'franchises', 'cast','artists','developers','illustrators','publishers','mechanics','perspectives']);
const fingerprint = (dimension: string, id: string) => JSON.stringify([dimension, id]);
const pairKey = (left: string, right: string) => JSON.stringify([left, right]);
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
export type TasteV2Catalogue = {size:number; counts:Record<string,number>; known:Partial<Record<Family,number>>};

/** Counts describe the eligible catalogue, not what the viewer saw or disliked. */
export function prepareTasteV2Catalogue(rows:Iterable<TasteV2Features>, dimensions:readonly Family[]=screenFamilies):TasteV2Catalogue {
  const counts:Record<string,number>=Object.create(null);
  const known:Partial<Record<Family,number>>={};
  let size=0;
  for(const features of rows) {
    size++;
    const terms=tokens(features,dimensions);
    const seen=new Set<Family>();
    for(const t of terms) {
      counts[t.key]=(counts[t.key]??0)+1;
      seen.add(t.dimension);
    }
    for(const dimension of seen) known[dimension]=(known[dimension]??0)+1;
  }
  return {size,counts,known};
}

type Counts = {watched:number; completed:number; returns:number; favourites:number; drops:number};
type Trait = {dimension: Family; id:string; name:string; key:string};
export type TasteV2Affinity = Omit<Trait, 'key'> & Counts & {
  affinity:number; confidence:number; works:number; independent:number; rated:number;
  supporting:string[]; contradicting:string[]; familiarity?:number; ratingFit?:number; ratingConfidence?:number; actionFit?:number; actionConfidence?:number;
};
export type TasteV2Signal = Omit<TasteV2Affinity,'dimension'> & {dimension:Family|'combination'; contribution:number; groupExample?:string};
type Pair = {left:string; right:string; offset:number; examples:string[]; works:number; distinct:number};
export type TasteV2Profile<M extends TasteMedium = TasteV2Medium> = {
  version:1; medium:M; stage:TasteV2Stage; works:number; ratings:number;
  affinities:TasteV2Affinity[]; pairs:Pair[]; dimensions:Family[];
  personalDimensions?:Family[]; retainedViewing?:TasteReference; signed?:TasteReference; display?:TasteV2Display;
  ordinal?:OrderedModel; contrast?:OrderedModel;
};
export type TasteV2Result = {score:number|null; confidence:number; signals:TasteV2Signal[]; reason:string; base?:number};

function tokens(features:TasteV2Features, dimensions:readonly Family[]):Trait[] {
  const result:Trait[] = [];
  const descriptions = new Set<string>();
  for (const dimension of dimensions) {
    const seen = new Set<string>();
    for (const f of features[dimension] ?? []) {
      if (!f.id || seen.has(f.id)) continue;
      seen.add(f.id);
      // A provider's duplicate "Animation" tag and genre are one descriptive observation.
      if (descriptive.has(dimension)) {
        const label = (f.name || f.id).trim().toLowerCase();
        if (descriptions.has(label)) continue;
        descriptions.add(label);
      }
      result.push({dimension, id:f.id, name:f.name || f.id, key:fingerprint(dimension,f.id)});
    }
  }
  return result;
}

type Vote = {value:number; mass:number};
function ratingVote(stars:number|null, reliability=1):Vote|undefined {
  if (stars === null || !Number.isFinite(stars) || stars < 0 || stars > 5 || !(reliability>0)) return;
  const value = fromStars(stars);
  return {value, mass:clamp(reliability,0,1) * (.55 + .45*Math.abs(value))};
}

function behaviour(work:TasteV2Observation['work'], habits:boolean):Vote|undefined {
  const votes:Vote[] = [];
  if (work.dropped) votes.push({value:-1,mass:1});
  if (work.explicit > 0) votes.push({value:1,mass:1});
  if (work.deliberateReturn || work.repeated) {
    votes.push({value:work.deliberateReturn ? .93 : .75,mass:work.deliberateReturn ? .9 : .65});
  } else if (work.consumed || work.chosen || work.completion === true) {
    const completed = work.completion === true;
    votes.push({value:completed ? .28 : .16,mass:completed ? .4 : .22});
  }
  if (habits && work.watchHabits) {
    const {pace=0,binge=0,behind=0} = work.watchHabits;
    if (pace > 0 || binge > 0) votes.push({value:.4,mass:.2*clamp(Math.max(pace,binge),0,1)});
    if (behind > 0) votes.push({value:-.2,mass:.2*clamp(behind,0,1)});
  }
  if (!votes.length) return;
  const mass = votes.reduce((sum,v)=>sum+v.mass,0);
  return {value:votes.reduce((sum,v)=>sum+v.mass*v.value,0)/mass, mass:Math.max(...votes.map(v=>v.mass))};
}

type Sample = {id:string; value:number};
type Total = {
  trait:Trait; works:number; groups:Set<string>; rated:number; ratingSum:number; ratingMass:number;
  behaviorSum:number; behaviorMass:number; counts:Counts; good:Sample[]; bad:Sample[];
};
function remember(list:Sample[],id:string,value:number) {
  if (list.length===3 && list[2].value>=value) return;
  list.push({id,value});
  list.sort((a,b)=>b.value-a.value || a.id.localeCompare(b.id));
  if (list.length>3) list.pop();
}
function newTotal(trait:Trait):Total {
  return {trait,works:0,groups:new Set(),rated:0,ratingSum:0,ratingMass:0,behaviorSum:0,behaviorMass:0,
    counts:{watched:0,completed:0,returns:0,favourites:0,drops:0},good:[],bad:[]};
}

function observe(total:Total, work:TasteV2Observation['work'], group:string, opinion:Vote|undefined, action:Vote|undefined) {
  total.works++;
  total.groups.add(group);
  if (opinion) {
    total.rated++;
    total.ratingMass += opinion.mass;
    total.ratingSum += opinion.value*opinion.mass;
  }
  if (action) {
    total.behaviorMass += action.mass;
    total.behaviorSum += action.value*action.mass;
  }
  total.counts.watched+=Number(work.consumed);
  total.counts.completed+=Number(work.completion===true);
  total.counts.returns+=Number(work.repeated || !!work.deliberateReturn);
  total.counts.favourites+=Number(work.explicit>0);
  total.counts.drops+=Number(!!work.dropped);
  const value = opinion?.value ?? action?.value ?? 0;
  if (value>0) remember(total.good,work.id,value);
  if (value<0) remember(total.bad,work.id,-value);
}

function affinity(total:Total,chosen:number,catalogue?:TasteV2Catalogue):TasteV2Affinity {
  const {dimension,id,name} = total.trait;
  // Behaviours are a distinct source of evidence. A large number of single watches
  // cannot overwhelm a well-supported explicit affinity for the same trait.
  const actionMass = total.ratingMass ? Math.min(total.behaviorMass*.55, Math.sqrt(total.behaviorMass),1+total.ratingMass*.35) : total.behaviorMass;
  const mass = total.ratingMass+actionMass;
  const actionMean = total.behaviorMass ? total.behaviorSum/total.behaviorMass : 0;
  const signed = (total.ratingSum + actionMass*actionMean) / Math.max(mass,Number.EPSILON);
  const groupRatio = total.groups.size/total.works;
  const independentFactor = specific.has(dimension) && dimension!=='franchises' ? Math.sqrt(groupRatio) : 1;
  const confidence = mass*independentFactor;
  const certainty=(amount:number)=>Math.round(100*amount*independentFactor/(amount*independentFactor+3));
  const observed=total.counts.watched;
  const catalogueCount=catalogue?.counts[total.trait.key]??0;
  const rateRatio=catalogue ? ((observed+.5)/(chosen+1))/((catalogueCount+2)/(catalogue.size+3)) : 1;
  const frequency=observed/(observed+4);
  // Knowledge of a relatively *popular* choice can corroborate a preference. Rare
  // choices and catalogue omissions never create a negative opinion. When metadata
  // is absent for this entire family in the catalogue, use only actual return breadth.
  const familiar=observed===0 ? 0 : frequency*(catalogue && (catalogue.known[dimension]??0)>0
    ? clamp(Math.log(rateRatio)/2,0,1) : 1);
  return {dimension,id,name,familiarity:familiar,
    ...(total.ratingMass ? {ratingFit:asFit(total.ratingSum/total.ratingMass),ratingConfidence:certainty(total.ratingMass)} : {}),
    ...(total.behaviorMass ? {actionFit:asFit(actionMean),actionConfidence:certainty(total.behaviorMass)} : {}),
    works:total.works,independent:total.groups.size,rated:total.rated,
    confidence:Math.round(100*confidence/(confidence+3)),affinity:asFit(signed),...total.counts,
    supporting:total.good.map(v=>v.id),contradicting:total.bad.map(v=>v.id)};
}

type RatingRow = {rating:number; reliability:number; traits:Trait[]; group:string; id:string};

// Cumulative-logit composite likelihood: all star boundaries share a sparse content
// vector. A monotone boundary update preserves valid probabilities at prediction.
// L2 shrinkage keeps rare terms near zero; intercepts preserve absolute star meanings.
function ordinalFit(rows:RatingRow[], totals:Map<string,Total>):TasteV2Profile['ordinal'] {
  const usable = rows.filter(row=>row.traits.length && row.reliability>0);
  const levels = [...new Set(usable.map(r=>r.rating))].sort((a,b)=>a-b);
  if (usable.length<12 || levels.length<2) return;
  const observed=new Set(usable.flatMap(r=>r.traits.map(t=>t.key)));
  const vocabulary = [...totals].filter(([k,t])=>t.rated>=2 && observed.has(k)).map(([k])=>k);
  if (!vocabulary.length) return;
  const indices = new Map(vocabulary.map((k,i)=>[k,i]));
  const design:OrderedObservation[] = usable.map(row=>{
    const ids:number[] = [], values:number[] = [];
    const terms = row.traits.filter(t=>indices.has(t.key));
    const counts = new Map<Family,number>();
    for (const t of terms) counts.set(t.dimension,1+(counts.get(t.dimension)??0));
    for (const t of terms) {
      ids.push(indices.get(t.key)!);
      values.push(Math.sqrt(weights[t.dimension]/counts.get(t.dimension)!));
    }
    return {indices:ids,values,rating:row.rating,mass:row.reliability};
  });
  return fitOrderedRatings(design,vocabulary,levels);
}

function jointFit(rows:RatingRow[], totals:Map<string,Total>):Pair[] {
  const observed=rows.map(row=>({group:row.group,reliability:row.reliability,value:fromStars(row.rating),
    families:new Set(row.traits.map(t=>t.dimension)),keys:new Set(row.traits.map(t=>t.key))}));
  const candidates=new Map<string,{left:Total;right:Total;mass:number;works:number;groups:Set<string>;examples:string[]}>();
  for(const row of rows) {
    const supported=row.traits.filter(t=>(totals.get(t.key)?.rated??0)>=4);
    for(const a of supported.filter(t=>descriptive.has(t.dimension))) {
      for(const b of supported.filter(t=>specific.has(t.dimension) || (t.dimension==='tags' && a.dimension==='genres'))) {
        const key=pairKey(a.key,b.key);
        let sample=candidates.get(key);
        if(!sample) {
          sample={left:totals.get(a.key)!,right:totals.get(b.key)!,mass:0,works:0,groups:new Set(),examples:[]};
          candidates.set(key,sample);
        }
        sample.works++;
        sample.groups.add(row.group);
        sample.mass+=row.reliability;
        if(sample.examples.length<3) sample.examples.push(row.id);
      }
    }
  }
  const result:Pair[]=[];
  for(const [key,sample] of candidates) {
    const {left,right,works,groups,mass}=sample;
    // An interaction is not identifiable when either parent only occurs with
    // the other. Keep the standalone affinities for explanations in that case.
    if(works<3 || groups.size<2 || left.rated-works<2 || right.rated-works<2 || !mass) continue;
    // Compare four groups with known data for both families. This checks a
    // genuine interaction after each trait's main effect; coincident metadata and
    // unknown parent fields never serve as counterexamples.
    const cell=Array.from({length:4},()=>({mass:0,sum:0,square:0,groups:new Set<string>()}));
    for(const row of observed) {
      if(!row.families.has(left.trait.dimension) || !row.families.has(right.trait.dimension)) continue;
      const c=cell[Number(row.keys.has(left.trait.key))+2*Number(row.keys.has(right.trait.key))];
      const v=row.value;
      c.sum+=row.reliability*v;
      c.square+=row.reliability*v*v;
      c.mass+=row.reliability;
      c.groups.add(row.group);
    }
    if(cell.some(c=>c.groups.size<3 || c.mass<3)) continue;
    const means=cell.map(c=>c.sum/c.mass);
    const difference=means[3]-means[2]-means[1]+means[0];
    const variance=cell.reduce((s,c,i)=>s+Math.max(.025,c.square/c.mass-means[i]**2)/Math.min(c.mass,c.groups.size),0);
    // A conservative noise allowance protects the strongest of many candidate
    // combinations. This is an evidence threshold, not a claim of a confidence interval.
    const residual=Math.max(0,Math.abs(difference)-3*Math.sqrt(variance));
    const offset=Math.sign(difference)*Math.min(12,residual*25)*groups.size/(groups.size+4);
    if(Math.abs(offset)<1) continue;
    const [a,b]:string[]=JSON.parse(key);
    result.push({left:a,right:b,works,distinct:groups.size,offset,examples:sample.examples});
  }
  return result;
}

export function trainTasteV2<M extends TasteMedium>(medium:M, observations:readonly TasteV2Observation[], options:TasteV2Options={}):TasteV2Profile<M> {
  const stage=options.stage??'personal';
  if(stage==='calibrated') {
    // Exact exclusion applies to every training step, including learning the card
    // scale. A known title cannot help decide how to grade its own prediction.
    const seen=new Set<string>();
    const rows=observations.filter(({work})=>{
      if(work.medium!==medium || work.id===options.excludeRoot || seen.has(work.id)) return false;
      seen.add(work.id);
      return true;
    });
    const base:TasteV2Options={...options,stage:'balanced',excludeRoot:undefined};
    const model=trainTasteV2(medium,rows,base);
    const rated=rows.filter(r=>r.work.rating!==null && (r.work.ratingReliability??1)>=1);
    if(rated.length>=50 && rated.filter(r=>r.work.rating===5).length>=8 && rated.filter(r=>r.work.rating!<=3).length>=8) {
      const folds=tasteV2DisplayFolds(rows);
      const points:DisplayPoint[]=[];
      for(let fold=0;fold<tasteV2DisplayFoldCount;fold++) {
        const previous=rows.filter(r=>folds.get(r.work.id)!==fold);
        const train=trainTasteV2(medium,previous,{...base,contextEvidence:false});
        for(const r of rated) if(folds.get(r.work.id)===fold) {
          const raw=scoreTasteV2(train,r.features,{details:false}).score;
          if(raw!==null) points.push({raw,stars:r.work.rating!});
        }
      }
      model.display=fitTasteV2Display(points);
    }
    model.stage=stage;
    return model;
  }
  const personal=stage==='personal' || stage==='contrast' || stage==='balanced';
  const ratingsEnabled=stage!=='actions';
  const actionsEnabled=['actions','combined','context','personal','contrast','balanced'].includes(stage);
  // Keep the tested personal behaviour model for shows, whose timing and completion
  // signals have different meaning to films. Its reference receives NO rating, child
  // rating, audience, friend or catalogue-selection penalty.
  const lastExperience=options.asOf??observations.reduce((last,{work})=>{
    if(work.medium!==medium || work.id===options.excludeRoot) return last;
    const at=work.lastExperiencedAt ? new Date(work.lastExperiencedAt).getTime() : 0;
    return Number.isFinite(at)?Math.max(last,at):last;
  },0);
  const viewing=personal && medium==='show' ? createTasteAccumulator({count:0,median:null},lastExperience) : undefined;
  const signed=stage==='balanced' ? createTasteAccumulator({count:0,median:null},lastExperience) : undefined;
  const dimensions=personalDimensionsFor(medium).filter(f=>(options.dimensions ? options.dimensions.includes(f) :
    (stage==='baseline' || stage==='ordinal') ? f==='genres' || f==='tags' : true) && (f!=='networks' || medium==='show'));
  const totals=new Map<string,Total>(), seen=new Set<string>();
  const rows:RatingRow[]=[];
  let works=0, ratings=0, chosen=0;
  for(const observation of observations) {
    const {work}=observation;
    if(work.medium!==medium || work.id===options.excludeRoot || seen.has(work.id)) continue;
    seen.add(work.id);
    const entries=tokens(observation.features,dimensions);
    const group=observation.features.franchises?.[0]?.id ? 'series:'+observation.features.franchises[0].id : 'work:'+work.id;
    const reliability=work.ratingReliability??1;
    const opinion=ratingsEnabled ? ratingVote(work.rating,reliability) : undefined;
    const action=actionsEnabled ? behaviour(work,options.habits??false) : undefined;
    const scoped=ratingsEnabled ? observation.credits : undefined;
    if(signed) {
      signed.add(work,observation.features);
      if(scoped?.length) signed.addScopedRatings(scoped);
    }
    if(!opinion && !action && !scoped?.length) continue;
    works++;
    if(viewing && action) viewing.add({...work,rating:null,lastRatedAt:null},observation.features);
    if(action && work.consumed) chosen++;
    if(opinion) {
      ratings++;
      rows.push({id:work.id,group,rating:work.rating!,reliability,traits:entries});
    }
    const admitted=new Set<string>();
    function addTrait(t:Trait, rating:Vote|undefined, actionVote:Vote|undefined) {
      if(admitted.has(t.key)) return;
      admitted.add(t.key);
      let total=totals.get(t.key);
      if(!total) {
        total=newTotal(t);
        totals.set(t.key,total);
      }
      observe(total,work,group,rating,actionVote);
    }
    if(opinion || action) for(const t of entries) addTrait(t,opinion,action);
    // Only the scoped credit receives the child vote; never recast it as another
    // vote on a genre, studio or network of the entire show.
    for(const credit of scoped??[]) {
      const value=ratingVote(credit.rating);
      if(!value) continue;
      for(const t of tokens(credit.features,dimensions)) if(specific.has(t.dimension) || t.dimension==='composers' || t.dimension==='cinematographers') addTrait(t,value,undefined);
    }
  }
  // A lone incidental credit is not a pattern, and storing every such performer
  // more than doubles a mature profile. The canonical work still trains other traits.
  const incidental=new Set<Family>(['cast','cinematographers','composers']);
  const retained=[...totals.values()].filter(t=>stage!=='balanced' || works<12 || t.works>1 || !incidental.has(t.trait.dimension));
  const result:TasteV2Profile<M>={version:tasteV2Version,medium,stage,works,ratings,dimensions,
    affinities:retained.map(t=>affinity(t,chosen,personal && medium==='movie' ? undefined : options.catalogue)),pairs:[]};
  const personalDimensions = medium!=='movie' ? dimensions : dimensions.filter(f=>descriptive.has(f) ||
    ['cast','directors','writers','creators','franchises'].includes(f));
  if(personal) result.personalDimensions=personalDimensions;
  const fittingRows=personal && personalDimensions.length!==dimensions.length
    ? rows.map(r=>({...r,traits:r.traits.filter(t=>personalDimensions.includes(t.dimension))})) : rows;
  if(ratingsEnabled && stage!=='baseline' && options.ordinal!==false) result.ordinal=ordinalFit(fittingRows,totals);
  if(stage==='contrast') {
    // A three-and-a-half-star title is neither disliked nor an enthusiastic
    // endorsement. Do not train it as a failure in the like/weak contrast head.
    const definitive=fittingRows.filter(r=>r.rating<=3 || r.rating>=4);
    const groups=new Map<string,number>();
    for(const r of definitive) groups.set(r.group,1+(groups.get(r.group)??0));
    if(definitive.filter(r=>r.rating<=3).length>=4 && definitive.filter(r=>r.rating>=4).length>=4) {
      const binary=definitive.map(r=>({...r,rating:r.rating>=4?5:1,
        reliability:r.reliability/Math.sqrt(groups.get(r.group)!),
        traits:r.traits.filter(t=>!specific.has(t.dimension) || t.dimension==='franchises' || (totals.get(t.key)?.groups.size??0)>1)}));
      result.contrast=ordinalFit(binary,totals);
    }
  }
  if(signed) result.signed=prepareTasteReference(signed.snapshot());
  if(viewing) result.retainedViewing=prepareTasteReference(viewing.snapshot(),undefined,viewing.returnWeights());
  if(stage==='context' || (personal && options.contextEvidence!==false)) result.pairs=jointFit(rows,totals);
  return result;
}

type Index = {traits:Map<string,TasteV2Affinity>;pairs:Map<string,Pair>};
const indices = new WeakMap<TasteV2Profile<TasteMedium>,Index>();
function index(profile:TasteV2Profile<TasteMedium>) {
  let saved=indices.get(profile);
  if(!saved) {
    saved={traits:new Map(profile.affinities.map(t=>[fingerprint(t.dimension,t.id),t])),pairs:new Map(profile.pairs.map(p=>[pairKey(p.left,p.right),p]))};
    indices.set(profile,saved);
  }
  return saved;
}

/** Compact server-side result. Contributions are points on the card's scale. */
export function scoreTasteV2(profile:TasteV2Profile<TasteMedium>, features:TasteV2Features, options:{details?:boolean}={}):TasteV2Result {
  if(profile.stage==='personal' || profile.stage==='contrast' || profile.stage==='balanced' || profile.stage==='calibrated') {
    const lookup=index(profile);
    const supported=profile.dimensions.some(f=>
      (descriptive.has(f) || specific.has(f) || f==='composers' || f==='cinematographers') &&
      features[f]?.some(t=>lookup.traits.has(fingerprint(f,t.id))));
    if(!supported) return {score:null,confidence:0,signals:[],reason:profile.works?'Insufficient shared evidence':'No personal evidence'};
    const details=options.details!==false;
    const fit=scorePersonal(profile,features,details);
    if(profile.stage==='personal' || profile.stage==='contrast') return fit;
    const raw=balance(profile,features,fit,details);
    if(raw.score===null || !profile.display) return raw;
    const adjusted=applyTasteV2Display(profile.display,raw.score);
    const factor=raw.score===50 ? 1 : (adjusted-50)/(raw.score-50);
    const signals=raw.signals.map(t=>({...t,contribution:t.contribution*factor}));
    return {...raw,score:Math.round(adjusted),signals,
      ...(details?{base:adjusted-signals.reduce((total,s)=>total+s.contribution,0)}:{})};
  }
  const lookup=index(profile);
  const entries=tokens(features,profile.dimensions);
  const matches=entries.flatMap(t=>{
    const known=lookup.traits.get(t.key);
    return known ? [{t,known}] : [];
  });
  const evidence=matches.some(({known})=>known.rated || known.favourites || known.returns || known.drops || known.watched>=2 || known.completed>=2);
  if(!evidence) return {score:null,confidence:0,signals:[],reason:profile.works?'Insufficient shared evidence':'No personal evidence'};

  const details=options.details!==false;
  const familyCounts=new Map<Family,number>(), ordinalCounts=new Map<Family,number>();
  const present=new Map<Family,number>();
  for(const t of entries) present.set(t.dimension,1+(present.get(t.dimension)??0));
  const model=profile.ordinal;
  for(const {t} of matches) {
    familyCounts.set(t.dimension,1+(familyCounts.get(t.dimension)??0));
    if(model && Object.hasOwn(model.coefficients,t.key)) ordinalCounts.set(t.dimension,1+(ordinalCounts.get(t.dimension)??0));
  }
  let mass=0, confidenceSum=0, latent=0;
  const terms=matches.map(({t,known})=>{
    const weight=weights[t.dimension]/familyCounts.get(t.dimension)! * Math.sqrt(known.confidence/100);
    const coefficient=model?.coefficients[t.key]??0;
    const value=coefficient ? coefficient*Math.sqrt(weights[t.dimension]/ordinalCounts.get(t.dimension)!) : 0;
    mass+=weight;
    confidenceSum+=weight*known.confidence;
    latent+=value;
    return {t,known,weight,value};
  });
  if(!mass) return {score:null,confidence:0,signals:[],reason:'Insufficient shared evidence'};
  // The preference model only participates when the target has a fitted term.
  // Separate its typical rating from the feature-specific evidence in the explanation.
  const learned=model && ordinalCounts.size ? Math.min(.85,profile.ratings/(profile.ratings+20)) : 0;
  let base=50, ordinalSlope=0;
  if(model && learned) {
    const typical=orderedValue(model,0);
    base+=learned*(typical-50);
    ordinalSlope=Math.abs(latent)>1e-8 ? (orderedValue(model,latent)-typical)/latent :
      (orderedValue(model,.0001)-orderedValue(model,-.0001))/.0002;
  }
  const usingActions=profile.stage==='actions' || profile.stage==='combined' || profile.stage==='context';
  const actionScale=usingActions ? 1/(1+profile.ratings/12) : 0;
  const choiceFamilies=[...present.keys()].filter(f=>descriptive.has(f) || specific.has(f));
  const signals:TasteV2Signal[]=[];
  let score=base;
  for(const {known,t,weight,value} of terms) {
    let contribution=(1-learned)*(known.affinity-50)*weight/mass + learned*value*ordinalSlope;
    if(actionScale && choiceFamilies.includes(t.dimension) && known.familiarity) {
      contribution+=actionScale*32*known.familiarity/(choiceFamilies.length*present.get(t.dimension)!);
    }
    score+=contribution;
    if(details) signals.push({...known,contribution});
  }
  if(lookup.pairs.size) {
    // Correlated combinations cannot be stacked into an arbitrarily large boost.
    let strongest:Pair|undefined;
    for(const {t:left} of matches) if(descriptive.has(left.dimension)) {
      for(const {t:right} of matches) {
        if(!specific.has(right.dimension) && !(left.dimension==='genres' && right.dimension==='tags')) continue;
        const pair=lookup.pairs.get(pairKey(left.key,right.key));
        if(pair && (!strongest || Math.abs(pair.offset)>Math.abs(strongest.offset))) strongest=pair;
      }
    }
    if(strongest) {
      const a=lookup.traits.get(strongest.left)!,b=lookup.traits.get(strongest.right)!;
      const contribution=clamp(score+strongest.offset,0,100)-score;
      if(details) signals.push({dimension:'combination',id:pairKey(strongest.left,strongest.right),name:a.name+' + '+b.name,
        affinity:clamp((a.affinity+b.affinity)/2+strongest.offset,0,100),works:strongest.works,independent:strongest.distinct,rated:strongest.works,
        confidence:Math.min(a.confidence,b.confidence),watched:0,completed:0,returns:0,favourites:0,drops:0,
        supporting:strongest.offset>0?strongest.examples:[],contradicting:strongest.offset<0?strongest.examples:[],contribution});
      score+=contribution;
    }
  }
  signals.sort((a,b)=>Math.abs(b.contribution)-Math.abs(a.contribution) || a.name.localeCompare(b.name));
  return {score:Math.round(clamp(score,0,100)),base,confidence:Math.round(confidenceSum/mass),signals,
    reason:learned?'Personal ratings and shared traits':profile.stage==='actions'?'Personal viewing choices':'Shared personal preferences'};
}

type PersonalScorers = {rated:TasteV2Profile<TasteMedium>; centered?:TasteV2Profile<TasteMedium>; actions:TasteV2Profile<TasteMedium>; retained?:ReturnType<typeof scorerFromReference>; signed?:ReturnType<typeof scorerFromReference>; signedDetail?:ReturnType<typeof scorerFromReference>};
const personalScorers = new WeakMap<TasteV2Profile<TasteMedium>,PersonalScorers>();
function personalModels(profile:TasteV2Profile<TasteMedium>):PersonalScorers {
  let models=personalScorers.get(profile);
  if(!models) {
    // Projections reuse evidence and examples from the one private publication.
    const core=profile.personalDimensions??profile.dimensions;
    const rated:TasteV2Profile<TasteMedium>={...profile,stage:'metadata',dimensions:core,affinities:[],pairs:[]};
    const actions:TasteV2Profile<TasteMedium>={...profile,stage:'actions',affinities:[],ratings:0,pairs:[],ordinal:undefined};
    for(const t of profile.affinities) {
      if(core.includes(t.dimension) && t.ratingFit!==undefined) rated.affinities.push({...t,works:t.rated,affinity:t.ratingFit,confidence:t.ratingConfidence!});
      if(t.actionFit!==undefined) actions.affinities.push({...t,rated:0,affinity:t.actionFit,confidence:t.actionConfidence!});
    }
    models={rated,actions,retained:profile.retainedViewing?scorerFromReference(profile.retainedViewing):undefined,
      signed:profile.signed?scorerFromReference(profile.signed):undefined,
      signedDetail:profile.signed?scorerFromReference(profile.signed,true):undefined};
    personalScorers.set(profile,models);
  }
  return models;
}

// For the product's fit scale, three stars anchors neutral, four anchors green
// and five anchors the upper end. This display projection makes no probability claim.
function displayFit(score:number) {
  if(score<=50) return score;
  return score<=75 ? 50+(score-50)*1.2 : 80+(score-75)*.8;
}

function ratingShare(profile:TasteV2Profile<TasteMedium>,rating:TasteV2Result,actions:TasteV2Result,actionScore:number|null) {
  if(rating.score===null) return 0;
  if(actionScore===null) return 1;
  const ordinary=profile.ratings/(profile.ratings+6);
  return profile.ratings<=6 && rating.confidence>=actions.confidence ? Math.max(ordinary,.5) : ordinary;
}

/** Test whether this work still clears neutral without a positive rating intercept or a lift from signed preferences. */
export function selectedLowerScore(profile:TasteV2Profile<TasteMedium>,features:TasteV2Features):number|null {
  if(!profile.ratings || profile.stage!=='calibrated') return null;
  const models=personalModels(profile);
  const personal=scorePersonal(profile,features,false);
  if(personal.score===null) return null;
  let adjusted=personal.score;
  const rating=scoreTasteV2(models.rated,features);
  if(rating.score!==null && rating.base!==undefined && rating.base>50 && models.rated.ordinal) {
    // Preserve which terms participated while measuring the effect of their fitted coefficients.
    models.centered??={...models.rated,ordinal:{...models.rated.ordinal,
      coefficients:Object.fromEntries(Object.keys(models.rated.ordinal.coefficients).map(key=>[key,0]))}};
    const total=(r:TasteV2Result)=>(r.base??50)+r.signals.reduce((n,s)=>n+s.contribution,0);
    const fitted=total(rating);
    if(fitted<total(scoreTasteV2(models.centered,features))-1e-8) {
      const actions=scoreTasteV2(models.actions,features,{details:false});
      const action=models.retained?.(features).score??actions.score;
      const opinion=ratingShare(profile,rating,actions,action);
      const recentered=Math.round(clamp(fitted-(rating.base-50),0,100));
      const mixed=opinion*recentered+(1-opinion)*(action??50);
      const margin=Math.max(0,6-personal.confidence/12);
      adjusted=Math.round(clamp(displayFit(mixed),margin,100-margin));
    }
  }
  const signed=models.signed?.(features).score;
  const fraction=signed!=null && signed<=adjusted && profile.works>=12 ? 1-Math.min(.5,profile.ratings/100) : 0;
  const raw=Math.round((1-fraction)*adjusted+fraction*(signed??0));
  return Math.round(applyTasteV2Display(profile.display,raw));
}

function scorePersonal(profile:TasteV2Profile<TasteMedium>,features:TasteV2Features,details:boolean):TasteV2Result {
  const models=personalModels(profile);
  const rating=scoreTasteV2(models.rated,features,{details});
  const actions=scoreTasteV2(models.actions,features,{details});
  const older=models.retained?.(features);
  const actionScore=older?.score??actions.score;
  if(rating.score===null && actionScore===null) return {score:null,confidence:0,signals:[],reason:'Insufficient shared evidence'};
  const opinion=ratingShare(profile,rating,actions,actionScore);
  let contrastShift=0;
  const contrastTerms:{t:Trait;value:number}[]=[];
  if(profile.contrast) {
    const contrast=profile.contrast;
    const matched=tokens(features,models.rated.dimensions).filter(t=>contrast.coefficients[t.key]);
    const counts=new Map<Family,number>();
    for(const t of matched) counts.set(t.dimension,1+(counts.get(t.dimension)??0));
    let latent=0;
    for(const t of matched) {
      const value=contrast.coefficients[t.key]*Math.sqrt(weights[t.dimension]/counts.get(t.dimension)!);
      latent+=value;
      if(details) contrastTerms.push({t,value});
    }
    contrastShift=.3*opinion*(orderedValue(contrast,latent)-orderedValue(contrast,0));
    if(details && Math.abs(latent)>1e-8) for(const t of contrastTerms) t.value*=contrastShift/latent;
    else contrastTerms.length=0;
  }
  const mixed=opinion*(rating.score??50)+(1-opinion)*(actionScore??50)+contrastShift;
  const confidence=Math.round(opinion*rating.confidence+(1-opinion)*(older?.score!=null ? older.confidence : actions.confidence));
  // A strong opinion about two films may approach an extreme. Reaching the endpoint
  // requires independent evidence; uncertainty does not repeatedly dilute every trait.
  const endpointMargin=Math.max(0,6-confidence/12);
  const final=clamp(displayFit(mixed),endpointMargin,100-endpointMargin);
  const factor=mixed===50 ? 1 : (final-50)/(mixed-50);
  const signals:TasteV2Signal[]=[];
  if(details) {
    const attributed=new Map<string,TasteV2Signal>();
    function accumulate(signal:TasteV2Signal, weight:number) {
      if(!weight || !signal.contribution) return;
      const key=fingerprint(signal.dimension,signal.id);
      const existing=attributed.get(key);
      if(existing) existing.contribution+=weight*signal.contribution*factor;
      else attributed.set(key,{...signal,contribution:weight*signal.contribution*factor});
    }
    for(const s of rating.signals) accumulate(s,opinion);
    // Do not present a film-style explanation for the retained show behaviour score.
    if(older?.score==null) for(const s of actions.signals) accumulate(s,1-opinion);
    else if(opinion<1) {
      const affinity=older.score;
      const delta=(affinity-50)*(1-opinion)*factor;
      signals.push({dimension:'combination',id:'viewing-pattern',name:'Viewing history',works:models.actions.works,
        independent:models.actions.works,rated:0,affinity,confidence:older.confidence,watched:0,completed:0,
        returns:0,favourites:0,drops:0,supporting:[],contradicting:[],contribution:delta});
    }
    for(const {t,value} of contrastTerms) {
      const trait=index(profile).traits.get(t.key);
      if(trait) accumulate({...trait,contribution:value},1);
    }
    signals.push(...attributed.values());
    signals.sort((a,b)=>Math.abs(b.contribution)-Math.abs(a.contribution));
  }
  return {score:Math.round(final),confidence,...(details?{base:final-signals.reduce((s,t)=>s+t.contribution,0)}:{}),
    signals,reason:opinion===0?'Personal viewing choices':opinion===1?'Personal ratings':'Personal ratings and viewing choices'};
}

/** Retain only the established signed trait evidence. The incumbent's catalogue
 * selection rules, rating correction, friends and audience scores do not enter this head. */
function balance(profile:TasteV2Profile<TasteMedium>, features:TasteV2Features, personal:TasteV2Result, details:boolean):TasteV2Result {
  const models=personalModels(profile);
  const signed=(details?models.signedDetail:models.signed)?.(features);
  if(!signed || signed.score===null || profile.works<12 || !profile.ratings) return personal;
  const candidateWeight=Math.min(.5,profile.ratings/100);
  const fraction=personal.score===null ? 1 : 1-candidateWeight;
  const score=(personal.score??50)*(1-fraction)+signed.score*fraction;
  const confidence=Math.round(personal.confidence*(1-fraction)+signed.confidence*fraction);
  const signals:TasteV2Signal[]=[];
  if(details) {
    for(const s of personal.signals) signals.push({...s,contribution:s.contribution*(1-fraction)});
    const parts=(signed.breakdown?.signals??[]).filter(s=>s.weightShare>0 && s.evidence.length);
    const partialSum=parts.reduce((sum,s)=>sum+(s.fit-50)*s.weightShare,0);
    const scale=Math.abs(partialSum)>1e-5 ? (signed.score-50)/partialSum : 0;
    for(const part of parts) {
      const top=part.evidence[0];
      const trait=features[part.dimension]?.find(t=>t.name===top.name);
      if(!trait) continue;
      const known=index(profile).traits.get(fingerprint(part.dimension,trait.id));
      if(!known) continue;
      signals.push({...known,name:part.dimension+' · '+top.name,id:'signed:'+known.id,affinity:part.fit,groupExample:top.name,
        contribution:scale*fraction*(part.fit-50)*part.weightShare});
    }
    signals.sort((a,b)=>Math.abs(b.contribution)-Math.abs(a.contribution));
  }
  return {score:Math.round(score),confidence,signals,...(details?{base:score-signals.reduce((s,t)=>s+t.contribution,0)}:{}),
    reason:personal.score===null?'Signed personal preferences':'Signed preferences and personal prediction'};
}

/** Exposes the eligible scoring paths for a profile trait. Actual item-specific
 * contributions still come from scoreTasteV2 and depend on the target's other traits. */
export function tasteV2AffinityUses(profile:TasteV2Profile<TasteMedium>, trait:TasteV2Affinity):string[] {
  const uses:string[]=[];
  const key=fingerprint(trait.dimension,trait.id);
  const personal=profile.personalDimensions!==undefined;
  if(trait.rated && (!personal || profile.personalDimensions!.includes(trait.dimension))) {
    uses.push('Rating evidence');
    if(profile.ordinal?.coefficients[key]) uses.push('Ordered rating model');
  }
  if(trait.actionFit!==undefined) {
    if(!profile.retainedViewing || Object.hasOwn(profile.retainedViewing.dimensions[trait.dimension as TasteDimension]??{},trait.id)) {
      uses.push('Viewing choices');
    }
  }
  if(profile.signed && Object.hasOwn(profile.signed.dimensions[trait.dimension as TasteDimension]??{},trait.id)) uses.push('Signed preferences');
  return uses;
}
