export const COMIC_EXPANDED_LIMIT=512*1024**2;
export const COMIC_PAGE_LIMIT=32*1024**2;
export const COMIC_ENTRY_LIMIT=10000;
export type ComicEntry={filename:string;size:number;index:number};
export type ComicArchive={entries:ComicEntry[];read(index:number,signal:AbortSignal):Promise<Blob>;close():Promise<void>};
const order=new Intl.Collator('en',{numeric:true});
export function orderComicEntries<T extends ComicEntry>(entries:T[]){return entries.sort((a,b)=>order.compare(a.filename,b.filename)||(a.filename<b.filename?-1:a.filename>b.filename?1:0));}
export function comicImage(filename:string){return !filename.startsWith('__MACOSX/')&&!filename.split('/').some(part=>part.startsWith('.'))&&/\.(png|jpe?g|webp|gif)$/i.test(filename);}
export function comicEntryName(filename:string){
 const name=filename.replaceAll('\\','/');
 if(name.length>2000||name.startsWith('/')||name.includes('\0')||name.split('/').some(part=>part==='..'||part==='.')||/^[a-z]:/i.test(name))throw new Error('This comic contains an invalid page path.');
 return name;
}
