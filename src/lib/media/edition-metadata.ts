import {metadataFields,type MetadataValues} from '#lib/catalogue/metadata/resolve.js';
/** Saved provider items can omit fields; empty values must not erase shared metadata. */
export function editionSnapshot(snapshot:Record<string,unknown>,durationSeconds?:number|null):MetadataValues{
 const values:MetadataValues={};
 for(const field of metadataFields){
  const value=snapshot[field];
  if(field==='genres'){
   if(Array.isArray(value)){const genres=value.filter((genre):genre is string=>typeof genre==='string'&&!!genre.trim());if(genres.length)values.genres=genres;}
  }else if(field==='runtimeMinutes'){
   if(typeof value==='number'&&Number.isFinite(value)&&value>0)values.runtimeMinutes=value;
  }else if(typeof value==='string'&&value.trim())Object.assign(values,{[field]:value});
 }
 if(durationSeconds&&Number.isFinite(durationSeconds)&&durationSeconds>0)values.runtimeMinutes=Math.round(durationSeconds/60);
 return values;
}
