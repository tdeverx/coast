/** Jellyfin source labels mix technical variants and named cuts. Only explicit edition labels become tabs. */
export function namedEdition(raw:string|null|undefined,title:string):{value:string;label:string} {
 let label=(raw??'').trim();
 if(title&&label.toLocaleLowerCase().startsWith(title.toLocaleLowerCase()))label=label.slice(title.length).replace(/^\s*(?:\([12][0-9]{3}\))?\s*[-–—:]*\s*/,'');
 const marker=label.match(/\{edition-([^}]+)\}/i);
 if(marker)label=marker[1].trim();
 else {
  // Do not expose codecs, resolutions, bitrates, channel layouts or containers as editions.
  label=label.replace(/\b(?:[0-9]{3,4}[pi]|[248]k|uhd|fhd|sd|hd|hdr10\+?|hdr|sdr|dv|dolby\s*vision|h\.?26[45]|[xh]26[45]|hevc|avc|av1|vp9|mkv|mp4|webm|mov|aac|e-?ac-?3|ac3|dts(?:-hd)?|truehd|atmos|flac|blu-?ray|bdrip|brrip|webrip|web[- .]?dl|remux|[0-9]+(?:\.[0-9]+)?\s*(?:mbps|kbps)|[257]\.1(?:\.[24])?)\b/gi,' ')
   .replace(/[\[\]()/|]+/g,' ').replace(/\s+[-–—]\s+/g,' ').replace(/\s+/g,' ').trim();
 }
 if(!label||/^(?:original|default|video)$/i.test(label)||/^theatrical(?: cut| release| edition)?$/i.test(label))return {value:'theatrical',label:'Theatrical'};
 if(!marker&&!/\b(?:theatrical|director['’]?s?|extended|uncut|unrated|censored|uncensored|special|final|ultimate|anniversary|criterion|restored|remastered|imax|open matte|black (?:and|&) white|colou?rized|edition|cut)\b/i.test(label))return {value:'theatrical',label:'Theatrical'};
 return {value:label.toLocaleLowerCase().replace(/['’]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim(),label};
}
export function editionChoices(sources:(string|null|undefined)[],title:string){
 return [...new Map(sources.map(source=>{const edition=namedEdition(source,title);return [edition.value,edition] as const;})).values()]
  .sort((a,b)=>Number(b.value==='theatrical')-Number(a.value==='theatrical')||a.label.localeCompare(b.label));
}
