import type {SelectedRule} from './taste-selected';
import {audienceConfirmsDislike, ratingUtility, type AudienceVote, type AudiencePeer} from './taste-selected-audience';
import type {TasteV2Features,TasteV2Medium} from './taste-v2';

export type SelectedWork = {
  id:string; family:string; genres:string[]; tags:string[]; leads:string[]; people:string[];
  credits:string[]; companies:string[]; audience?:AudienceVote; synopsis?:number[];
};
export type SelectedDonor = SelectedWork & {stars:number; native:number|null; publicNative:number|null};
export type SelectedMetadata = {
  credits?:readonly {id:string|number;role:string}[]|null;
  studios?:readonly {id:string|number}[]|null; networks?:readonly {id:string|number}[]|null;
  audience?:{score:number;votes:number;scale?:number}|null; synopsis?:number[];
};
const unique = (values:string[]) => [...new Set(values)].sort();
const display = (value:number) => Math.max(0,Math.min(100,Math.round(value)));
const mean = (ns:number[]) => ns.reduce((a,b)=>a+b,0)/ns.length;
function median(ns:number[]) {
  ns.sort((a,b)=>a-b);
  return (ns[Math.floor((ns.length-1)/2)]+ns[Math.floor(ns.length/2)])/2;
}
export function selectedWork(id:string,family:string,medium:TasteV2Medium,features:TasteV2Features,metadata:SelectedMetadata):SelectedWork {
  const leadRoles=medium==='movie' ? ['Director'] : ['Creator','Showrunner'];
  const leads=unique((metadata.credits??[]).filter(c=>leadRoles.includes(c.role) && /^\d+$/.test(String(c.id))).map(c=>'tmdb:'+c.id));
  const groups=(['cast','directors','writers'] as const).flatMap(role=>
    (features[role]??[]).filter(f=>f.id.startsWith('tmdb:')).map(f=>({role,id:f.id})));
  const companies=unique((['studios','networks'] as const).flatMap(role=>
    (metadata[role]??[]).filter(c=>/^\d+$/.test(String(c.id))).map(c=>role+':'+c.id)));
  const credits=unique([...groups.map(c=>c.role+':'+c.id),...leads.map(k=>(medium==='movie'?'directors:':'creator:')+k),...companies]);
  const crowd=metadata.audience;
  const audience=crowd && (crowd.scale===undefined || crowd.scale===10) && Number.isInteger(crowd.votes) && crowd.votes>0 &&
    crowd.score>0 && crowd.score<=10 ? {score:crowd.score,votes:crowd.votes} : undefined;
  return {id,family,genres:unique((features.genres??[]).map(f=>f.id)),tags:unique((features.tags??[]).map(f=>f.id)),
    leads,people:unique([...leads,...groups.map(c=>c.id)]),credits,companies,audience,synopsis:metadata.synopsis};
}

type Index = Map<string,SelectedDonor[]>;
type Indexed = 'tags'|'genres'|'people'|'companies'|'credits';
function indexDonor(index:Index,key:string,d:SelectedDonor) {
  const rows=index.get(key);
  if(rows) rows.push(d);
  else index.set(key,[d]);
}
export function buildSelectedReference(donors:readonly SelectedDonor[]) {
  const indices:Record<Indexed,Index>={tags:new Map(),genres:new Map(),people:new Map(),companies:new Map(),credits:new Map()};
  const teams:Index=new Map(), ids=new Set<string>(),families=new Set<string>();
  const plots:SelectedDonor[]=[];
  for(const d of donors) {
    if(ids.has(d.id) || !Number.isFinite(d.stars) || d.stars<0 || d.stars>5 || !d.family) continue;
    ids.add(d.id);
    families.add(d.family);
    for(const field of Object.keys(indices) as Indexed[]) for(const key of new Set(d[field])) indexDonor(indices[field],key,d);
    if(d.leads.length) indexDonor(teams,JSON.stringify(unique(d.leads)),d);
    if(d.synopsis?.length) plots.push(d);
  }
  return {indices,teams,plots,families};
}
type Reference = ReturnType<typeof buildSelectedReference>;
type Residuals = {exact?:ReadonlyMap<string,number>; public?:ReadonlyMap<string,number>};
const excludedResiduals:ReadonlyMap<string,number>=new Map();
function jaccard(a:string[],b:string[]) {
  let shared=0;
  for(const key of a) if(b.includes(key)) shared++;
  return shared ? shared/(a.length+b.length-shared) : 0;
}
function eligible(rows:SelectedDonor[]|undefined,target:SelectedWork) {
  return (rows??[]).filter(d=>d.id!==target.id && d.family!==target.family);
}
function byFamily(donors:SelectedDonor[]) {
  const groups=new Map<string,SelectedDonor[]>();
  for(const d of donors) indexDonor(groups,d.family,d);
  return groups;
}
function exactTeam(ref:Reference,t:SelectedWork,native:number,overrides?:ReadonlyMap<string,number>) {
  if(!t.leads.length) return native;
  const matches=eligible(ref.teams.get(JSON.stringify(unique(t.leads))),t);
  if(matches.some(d=>d.stars>2.5)) return native;
  const errors=new Map<string,number[]>();
  for(const donor of matches) {
    const predicted=overrides ? overrides.get(donor.id) : donor.native;
    if(predicted==null || jaccard(t.genres,donor.genres)<.5) continue;
    const value=ratingUtility(donor.stars)-predicted, group=errors.get(donor.family);
    if(group) group.push(value);
    else errors.set(donor.family,[value]);
  }
  return errors.size ? display(native+Math.min(0,mean([...errors.values()].map(mean)))) : native;
}
function publicPeers(ref:Reference,t:SelectedWork,overrides?:ReadonlyMap<string,number>) {
  const candidates=new Set<SelectedDonor>();
  for(const field of ['genres','tags'] as const) for(const key of t[field]) {
    for(const d of ref.indices[field].get(key)??[]) if(d.audience && d.family!==t.family && d.id!==t.id) candidates.add(d);
  }
  const peers:AudiencePeer[]=[];
  for(const d of candidates) peers.push({family:d.family,stars:d.stars,audience:d.audience!,
    predicted:overrides ? overrides.get(d.id)??null : d.publicNative,
    similarity:(jaccard(t.genres,d.genres)+jaccard(t.tags,d.tags))/2});
  return peers;
}
type Clue = {members:SelectedDonor[]; lows:SelectedDonor[]; families:Set<string>; leads:Set<string>; estimate:number};
function independent(a:Clue,b:Clue) {
  return ![...a.families].some(f=>b.families.has(f)) && ![...a.leads].some(p=>b.leads.has(p));
}
/** Story clues must be unanimous in comparable genres. Studio clues need a majority across families. */
function clues(index:Index,keys:string[],t:SelectedWork,story:boolean) {
  const out:Clue[]=[];
  for(const key of keys) {
    const all=index.get(key);
    if(!all?.some(d=>d.stars<=2.5)) continue;
    const members=eligible(all,t);
    const pool=story ? members.filter(d=>jaccard(t.genres,d.genres)>=.5) : members;
    const families=byFamily(pool);
    const low=[...families.values()].filter(xs=>xs.every(d=>d.stars<=2.5));
    if(story ? !low.length || low.length!==families.size : low.length<2 || 2*low.length<=families.size) continue;
    const lows=low.flat();
    if(lows.some(d=>!d.leads.length)) continue;
    out.push({members,lows,families:new Set(lows.map(d=>d.family)),leads:new Set(lows.flatMap(d=>d.leads)),
      estimate:median([...families.values()].map(group=>mean(group.map(d=>ratingUtility(d.stars)))))});
  }
  return out;
}
function sharedFavourite(a:Clue,b:Clue) {
  const ids=new Set(a.members.filter(d=>d.stars>=4).map(d=>d.id));
  return b.members.some(d=>ids.has(d.id));
}
function genreMargin(t:SelectedWork,c:Clue) {
  if(!t.genres.length) return 0;
  let bad=0, good=-1;
  for(const d of c.lows) if(d.genres.length) bad=Math.max(bad,jaccard(t.genres,d.genres));
  for(const d of c.members) if(d.stars>3 && d.genres.length) good=Math.max(good,jaccard(t.genres,d.genres));
  return bad>0 && good>=0 ? Math.max(0,(bad-good)/bad) : 0;
}
function personCompany(ref:Reference,t:SelectedWork,start:number) {
  const firms=clues(ref.indices.companies,t.companies,t,false)
    .filter(c=>new Set(c.lows.filter(d=>jaccard(t.genres,d.genres)>=.5).map(d=>d.family)).size>=2);
  if(!firms.length) return;
  let highest:number|undefined;
  for(const p of clues(ref.indices.people,t.people,t,false)) for(const f of firms) {
    if(!independent(p,f) || sharedFavourite(p,f)) continue;
    const strength=Math.min(genreMargin(t,p),genreMargin(t,f)), proposed=display(Math.max(p.estimate,f.estimate));
    highest=Math.max(highest??0,start+strength*(proposed-start));
  }
  return highest===undefined ? undefined : display(highest);
}
function dot(a:number[],b:number[]) {
  let total=0;
  for(let k=0;k<a.length;k++) total+=a[k]*b[k];
  return total;
}
function storyCredit(ref:Reference,t:SelectedWork,start:number) {
  const vector=t.synopsis;
  if(!vector?.length || !ref.plots.length) return start;
  const tags=clues(ref.indices.tags,t.tags.filter(k=>k.startsWith('tmdb:')),t,true);
  if(!tags.length) return start;
  const credits=clues(ref.indices.credits,t.credits,t,true);
  const pairs=tags.flatMap(tag=>credits
    .filter(credit=>independent(tag,credit) && !sharedFavourite(tag,credit)).map(credit=>[tag,credit] as const));
  if(!pairs.length) return start;
  let best:SelectedDonor|undefined, first=-Infinity, second=-Infinity, positive=-Infinity;
  for(const d of ref.plots) {
    if(d.family===t.family || d.id===t.id || d.synopsis!.length!==vector.length) continue;
    const sim=dot(vector,d.synopsis!);
    if(d.stars>3) positive=Math.max(positive,sim);
    if(sim>first) { second=first; first=sim; best=d; }
    else second=Math.max(second,sim);
  }
  if(!best?.leads.length || best.stars>2.5 || first<=0 || first-second<=1e-12 || !Number.isFinite(positive)) return start;
  let estimate:number|undefined;
  for(const [a,b] of pairs) {
    if(a.families.has(best.family) || b.families.has(best.family) || best.leads.some(p=>a.leads.has(p)||b.leads.has(p))) continue;
    estimate=Math.max(estimate??0,display(a.estimate),display(b.estimate));
  }
  return estimate===undefined ? start : display(start+(estimate-start)*(first-Math.max(0,positive))/first);
}

/** Use the calibrated personal score unchanged unless independent comparisons justify a correction. */
export function scoreSelected(ref:Reference,t:SelectedWork,native:number,lower:()=>number|null,residuals?:Residuals) {
  const unverified=ref.families.has(t.family) ? excludedResiduals : undefined;
  let score=exactTeam(ref,t,native,residuals?.exact??unverified);
  let rule:SelectedRule=score===native ? 'personal' : 'exact-team';
  if(score===native && native>=50 && t.audience && t.audience.score<6) {
    const ablated=lower();
    if(ablated!==null && ablated<50 && audienceConfirmsDislike(t.audience,publicPeers(ref,t,residuals?.public??unverified))) {
      score=ablated;
      rule='personalised-tmdb';
    }
  }
  if(score>=50) {
    const studio=personCompany(ref,t,score);
    const next=studio??storyCredit(ref,t,score);
    if(next!==score) {
      score=next;
      rule=studio===undefined ? 'story-credit' : 'person-company';
    }
  }
  return {score,rule};
}
