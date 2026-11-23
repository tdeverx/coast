import type {TasteFeatures, TasteReference} from './taste-profile';
import type {TasteObservation} from './taste-training';

const roles = ['directors', 'writers'] as const;
type Role = typeof roles[number];
const contexts = ['genres', 'tags', 'themes'] as const;
type Vote = {rating:number; weight:number; group:string; contexts:string[]; parent:boolean};
type Pattern = {strength:number; liked:number; rated:number; independent:number; veto?:string[]};
export type CreatorPreferences = Partial<Record<Role, Record<string, Pattern>>>;
const unit = (n:number) => Math.max(0, Math.min(1,n));

/** A creator can lead a match when the viewer consistently likes their work across independent titles. */
export function createCreatorTrainer() {
  const votes = {directors:new Map<string,Vote[]>(), writers:new Map<string,Vote[]>()};
  let rated = 0, liked = 0;
  return {
    add({work,features,credits}:TasteObservation) {
      if (work.rating === null && !credits?.length) return;
      const weight = work.ratingReliability ?? 1;
      if (work.rating !== null) {
        rated += weight;
        if (work.rating >= 4) liked += weight;
      }
      if (!roles.some(role => features[role]?.length || credits?.some(row => row.features[role]?.length))) return;
      const group = features.franchises?.reduce<string|undefined>((key,f) => !key || f.id < key ? f.id : key,undefined) ?? work.id;
      const terms = contexts.flatMap(d => [...new Set(features[d]?.map(f => d+':'+f.id))]);
      function record(facts:TasteFeatures, vote:Vote) {
        for (const role of roles) for (const id of new Set(facts[role]?.map(f => f.id))) {
          const rows = votes[role].get(id);
          if (rows) rows.push(vote);
          else votes[role].set(id,[vote]);
        }
      }
      if (work.rating !== null) record(features,{rating:work.rating, weight, group, contexts:terms, parent:true});
      // Scoped credits are distinct within this root and exclude people already credited on the parent.
      for (const row of credits ?? []) record(row.features,{rating:row.rating, weight:1, group, contexts:terms, parent:false});
    },
    finish(reference:TasteReference) {
      const result:CreatorPreferences = {};
      for (const role of roles) for (const [id,rows] of votes[role]) {
        if (rows.length < 3 || !Object.hasOwn(reference.dimensions[role] ?? {},id)) continue;
        let total = 0, high = 0, outside = rated, outsideHigh = liked, highCount = 0;
        const groups = new Map<string,number>();
        for (const {rating,weight,group,parent} of rows) {
          total += weight;
          if (parent) outside -= weight;
          if (rating < 4) continue;
          if (parent) outsideHigh -= weight;
          high += weight;
          highCount++;
          groups.set(group,Math.min(1,(groups.get(group) ?? 0)+weight));
        }
        const independent = [...groups.values()].reduce((n,w) => n+w,0);
        if (independent <= 2) continue;
        const rate = (high+1)/(total+2);
        const ordinary = (Math.max(0,outsideHigh)+2)/(Math.max(0,outside)+4);
        const strength = unit((independent-2)/4)*unit((rate-.62)/.26)*unit((rate-ordinary)/.15);
        if (strength < .02) continue;
        const evidence = new Map<string,{low:number;high:number}>();
        for (const row of rows) for (const term of row.contexts) {
          const count = evidence.get(term) ?? {low:0,high:0};
          if (row.rating <= 2.5) count.low += row.weight;
          else if (row.rating >= 4) count.high += row.weight;
          evidence.set(term,count);
        }
        // Two corroborating dislikes suppress the promotion in that particular context.
        const veto = [...evidence].filter(([,n]) => n.low >= 2 && n.low >= 2*n.high).map(([term]) => term).sort();
        const patterns = result[role] ??= Object.create(null) as Record<string,Pattern>;
        patterns[id] = {strength:Math.round(1000*strength)/1000, liked:highCount, rated:rows.length,
          independent:groups.size, ...(veto.length ? {veto} : {})};
      }
      return result.directors || result.writers ? result : undefined;
    },
  };
}

export function applicableCreatorPattern(patterns:CreatorPreferences|undefined, role:Role, id:string, features:TasteFeatures) {
  const entries = patterns?.[role];
  if (!entries || !Object.hasOwn(entries,id)) return;
  const pattern = entries[id];
  if (pattern.veto?.length && contexts.some(d => features[d]?.some(f => pattern.veto!.includes(d+':'+f.id)))) return;
  return pattern;
}
