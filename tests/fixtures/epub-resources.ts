import {expect} from 'bun:test';
import {ZipWriter,BlobWriter,TextReader} from '@zip.js/zip.js';
import {ownEpubResources} from '../../src/lib/reading/reader/epub-resources';

Object.assign(globalThis,{window:{URL,decodeURIComponent,Blob}});
// Exercise installed allocation methods; upstream only declares the public EPUB entrypoint.
const {default:Archive}=await import(import.meta.resolve('epubjs/lib/archive.js'));
const {default:Resources}=await import(import.meta.resolve('epubjs/lib/resources.js'));
const {default:Book}=await import(import.meta.resolve('epubjs/lib/book.js'));
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>resolve=done);return {promise,resolve};};
const fetchable=async(url:string)=>{try{return (await fetch(url)).ok;}catch{return false;}};
async function fixture(){
 const writer=new ZipWriter(new BlobWriter(),{useWebWorkers:false,level:0});
 await writer.add('OPS/image.svg',new TextReader('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'));
 await writer.add('OPS/style.css',new TextReader('body { background: url(image.svg); }'));
 const archive=new Archive();await archive.open(await (await writer.close()).arrayBuffer());
 const resources=new Resources({style:{href:'OPS/style.css',type:'text/css'},image:{href:'OPS/image.svg',type:'image/svg+xml'}},{archive,resolver:(path:string)=>'/'+path,replacements:'blobUrl'});
 const book={archive,resources,replacements:()=>resources.replacements().then(()=>resources.replaceCss())};
 const owner=ownEpubResources(book);
 await book.replacements();
 return {archive,resources,book,owner,urls:[...Object.values(archive.urlCache),...resources.replacementUrls] as string[]};
}
const independent=await fixture();
for(let cycle=0;cycle<5;cycle++){
 const f=await fixture();expect(new Set(f.urls).size).toBe(3);
 expect(await Promise.all(f.urls.map(fetchable))).toEqual(f.urls.map(()=>true));
 f.owner.destroy();f.archive.destroy();f.resources.destroy();f.owner.destroy();
 expect(await Promise.all(f.urls.map(fetchable))).toEqual(f.urls.map(()=>false));
 expect(await fetchable(independent.urls[0])).toBe(true);
}
// Pause actual library reads before allocation, close their owner, then finish the reads.
for(const kind of ['asset','css'] as const){
 const f=await fixture(),gate=deferred<Blob|string>();let created:string|undefined;
 if(kind==='asset')f.archive.getBlob=()=>gate.promise;
 else f.archive.getText=()=>gate.promise;
 const allocate=URL.createObjectURL.bind(URL);
 URL.createObjectURL=blob=>{created=allocate(blob);return created;};
 try{
  const pending=kind==='asset'?f.archive.createUrl('/OPS/late.svg'):f.resources.createCssFile('OPS/style.css');
  void pending.catch(()=>{});f.owner.destroy();
  gate.resolve(kind==='asset'?new Blob(['late asset']):'body { color: black; }');
  await expect(pending).rejects.toMatchObject({name:'AbortError'});
  expect(created).toBeDefined();expect(await fetchable(created!)).toBe(false);
 }finally{URL.createObjectURL=allocate;f.archive.destroy();f.resources.destroy();}
}
independent.owner.destroy();independent.archive.destroy();independent.resources.destroy();
// Actual Book.open must install the wrappers before the first automatic replacements.
{
 const writer=new ZipWriter(new BlobWriter(),{useWebWorkers:false,level:0});
 for(const [name,text] of Object.entries({
  'META-INF/container.xml':'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  'OPS/package.opf':'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fixture</dc:identifier><dc:title>Fixture</dc:title><dc:language>en</dc:language><meta property="rendition:layout">reflowable</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="image" href="image.svg" media-type="image/svg+xml"/><item id="css" href="style.css" media-type="text/css"/></manifest><spine><itemref idref="chapter"/></spine></package>',
  'OPS/chapter.xhtml':'<html xmlns="http://www.w3.org/1999/xhtml"><head/><body>Fixture</body></html>',
  'OPS/image.svg':'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
  'OPS/style.css':'body { background: url(image.svg); }',
 }))await writer.add(name,new TextReader(text));
 const book=new Book(),owner=ownEpubResources(book);
 await book.open(await (await writer.close()).arrayBuffer(),'binary');await book.opened;
 const urls=[...new Set([...Object.values(book.archive.urlCache),...book.resources.replacementUrls])] as string[];
 expect(urls).toHaveLength(3);expect(await Promise.all(urls.map(fetchable))).toEqual([true,true,true]);
 owner.destroy();book.destroy();expect(await Promise.all(urls.map(fetchable))).toEqual([false,false,false]);
}
console.log(JSON.stringify({cycles:5,lateAsset:true,lateCss:true,independentBook:true,actualBookOpen:true}));
