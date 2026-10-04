export const tasteDimensions = ['genres','tags','themes','cast','directors','writers','franchises','developers','publishers','mechanics','perspectives','artists'] as const;
export type TasteDimension = typeof tasteDimensions[number];
export type TasteFeature = {id:string;name:string};
export type TasteFeatures = Partial<Record<TasteDimension,TasteFeature[]>>;
export type TasteEvidence = {id:string;weight:number;features:TasteFeatures};
export type TasteAffinity = TasteFeature & {value:number;samples:number};
export type TasteProfile = {version:1;works:number;dimensions:Partial<Record<TasteDimension,TasteAffinity[]>>};
const weights:Record<TasteDimension,number> = {genres:25,tags:20,themes:15,cast:8,directors:15,writers:10,franchises:10,developers:12,publishers:3,mechanics:15,perspectives:8,artists:25};
export function namedFeatures(names:string[]):TasteFeature[]{
 return [...new Set(names.map(name=>name.trim()).filter(Boolean))].slice(0,100).map(name=>({id:name.toLocaleLowerCase('en-US'),name}));
}
/** Each title votes once. Explicit dislikes take precedence over exposure or ownership. */
export function buildTasteProfile(evidence:TasteEvidence[]):TasteProfile {
 const works=new Map<string,TasteEvidence>();
 for(const work of evidence){const existing=works.get(work.id);if(!existing||work.weight<0||existing.weight>=0&&work.weight>existing.weight)works.set(work.id,work);}
 const dimensions:TasteProfile['dimensions']={};
 for(const dimension of tasteDimensions){
  const values=new Map<string,TasteAffinity>();
  for(const work of works.values())for(const feature of new Map((work.features[dimension]??[]).map(feature=>[feature.id,feature])).values()){
   if(!work.weight)continue;
   const old=values.get(feature.id)??{...feature,value:0,samples:0};
   old.value+=Math.max(-6,Math.min(5,work.weight));old.samples++;values.set(feature.id,old);
  }
  dimensions[dimension]=[...values.values()].map(value=>({...value,value:Math.max(-1,Math.min(1,value.value/(value.samples*5)*Math.min(1,value.samples/3)))})).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)||a.id.localeCompare(b.id)).slice(0,500);
 }
 return {version:1,works:works.size,dimensions};
}
/** A fit estimate, not a predicted rating. Sparse/missing dimensions do not become dislikes. */
export function scoreTaste(profile:TasteProfile,features:TasteFeatures){
 const dimensions:Partial<Record<TasteDimension,number>>={},reasons:{dimension:TasteDimension;name:string;strength:number}[]=[];
 let total=0,available=0,matches=0,confidenceTotal=0;
 for(const dimension of tasteDimensions){
  const candidates=features[dimension]??[],affinities=profile.dimensions[dimension]??[];
  if(!candidates.length||!affinities.length)continue;
  const lookup=new Map(affinities.map(feature=>[feature.id,feature]));
  const known=candidates.flatMap(feature=>{const affinity=lookup.get(feature.id);return affinity?[affinity]:[];});
  if(!known.length)continue;
  // Cast exposure needs repeated titles. One positive actor appearance alone is weak evidence.
  const supported=known.filter(feature=>dimension!=='cast'||feature.samples>=2||feature.value<0);
  if(!supported.length)continue;
  const fit=supported.reduce((sum,feature)=>sum+feature.value,0)/supported.length;
  dimensions[dimension]=Math.round(50+50*fit);total+=fit*weights[dimension];available+=weights[dimension];matches+=supported.length;
  confidenceTotal+=Math.min(1,supported.reduce((sum,feature)=>sum+feature.samples,0)/supported.length/5)*weights[dimension];
  for(const feature of supported)if(feature.value>0&&feature.samples>=2)reasons.push({dimension,name:feature.name,strength:feature.value*weights[dimension]});
 }
 const confidence=available?Math.min(1,profile.works/10)*(confidenceTotal/available):0;
 return {score:available?Math.round(50+50*total/available):null,confidence:Math.round(confidence*100),dimensions,reasons:reasons.sort((a,b)=>b.strength-a.strength||a.name.localeCompare(b.name)).slice(0,3).map(({dimension,name})=>({dimension,name})),matches};
}
