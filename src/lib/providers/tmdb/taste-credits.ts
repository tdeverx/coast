import type {CatalogueFacts,CastMember} from '../contracts';
import type {TasteDimension,TasteFeature,TasteFeatures} from '#lib/social/taste-profile.js';

const roles=new Map<string,TasteDimension>([
 ['Director','directors'],['Writer','writers'],['Screenplay','writers'],['Teleplay','writers'],['Story','writers'],
 ['Original Music Composer','composers'],['Composer','composers'],
 ['Director of Photography','cinematographers'],['Cinematography','cinematographers'],
]);

/** TMDB person IDs span titles and distinguish people who share a credit name. */
export function tmdbCrewFeatures(credits:CatalogueFacts['credits']):TasteFeatures{
 const features:TasteFeatures={},seen=new Set<string>();
 for(const person of Array.isArray(credits)?credits:[]){
  const dimension=roles.get(person?.role);
  if(!dimension||!/^\d+$/.test(person.id)||typeof person.name!=='string'||!person.name.trim())continue;
  const key=dimension+':'+person.id;
  if(seen.has(key))continue;
  seen.add(key);
  (features[dimension]??=[]).push({id:'tmdb:'+person.id,name:person.name.trim()});
 }
 return features;
}

export function tmdbCastFeatures(people:readonly Pick<CastMember,'id'|'name'>[]):TasteFeature[]{
 const entries=new Map<number,TasteFeature>();
 for(const person of people){
  if(!Number.isSafeInteger(person?.id)||person.id<=0||typeof person.name!=='string'||!person.name.trim()||entries.has(person.id))continue;
  entries.set(person.id,{id:'tmdb:'+person.id,name:person.name.trim()});
  if(entries.size===20)break;
 }
 return [...entries.values()];
}
