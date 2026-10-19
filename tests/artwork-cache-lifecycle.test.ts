import {expect,test} from 'bun:test';
import {mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const key=(n:number)=>n.toString(16).padStart(64,'0')+'.image';
const compile=(source:string)=>`data:text/javascript;base64,${Buffer.from(new Bun.Transpiler({loader:'ts'}).transformSync(source)).toString('base64')}`;
const artworkFlightsPath=new URL('../src/lib/providers/artwork-flight.server.ts',import.meta.url).pathname;
const withArtworkFlights=(source:string)=>source.replace(/from ['"]\.\.?\/artwork-flight\.server['"]/,`from ${JSON.stringify(artworkFlightsPath)}`);
const diskBoundary=Symbol.for('coast.test.cache-write');
const globals=globalThis as typeof globalThis & {[diskBoundary]?:typeof writeFile};
const cacheSource=(await Bun.file(new URL('../src/lib/server/storage/image-cache.server.ts',import.meta.url)).text())
 .replace('statfs, unlink, writeFile }','statfs, unlink, writeFile as originalWriteFile }')
 + `\nconst writeFile=(...args)=>{const hook=globalThis[Symbol.for('coast.test.cache-write')];return hook?hook(...args):originalWriteFile(...args);};`;
const {createImageCache}:typeof import('../src/lib/server/storage/image-cache.server')=await import(compile(cacheSource));
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(cause:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

test('cache pending byte/write admission declines immediately and restores credits after success, decline and failure',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'coast-cache-pending-'));
 try{
  const gate=deferred<void>(),started=deferred<void>();let diskWrites=0;
  globals[diskBoundary]=(async(...args:Parameters<typeof writeFile>)=>{diskWrites++;started.resolve();await gate.promise;await writeFile(...args);}) as typeof writeFile;
  const cache=createImageCache(directory,{bytes:100,files:20,freeBytes:0,pendingBytes:12,pendingWrites:2});
  const first=cache.put(key(1),new Uint8Array(8));await started.promise;
  const second=cache.put(key(2),new Uint8Array(4));
  expect(await cache.put(key(3),new Uint8Array(1))).toBe(false);expect(diskWrites).toBe(1);
  gate.resolve();expect(await first).toBe(true);expect(await second).toBe(true);
  expect(await cache.put(key(3),new Uint8Array(12))).toBe(true);
  expect(await cache.put(key(4),new Uint8Array(13))).toBe(false);
  expect(await cache.put(key(4),new Uint8Array(1))).toBe(true);
  let fail=true;
  globals[diskBoundary]=(async(...args:Parameters<typeof writeFile>)=>{if(fail)throw new Error('Synthetic disk failure');await writeFile(...args);}) as typeof writeFile;
  await expect(cache.put(key(5),new Uint8Array(12))).rejects.toThrow('Synthetic disk failure');
  fail=false;expect(await cache.put(key(5),new Uint8Array(12))).toBe(true);
  expect((await readdir(directory)).some(file=>file.includes('.image.'))).toBe(false);
  const limits={bytes:100,files:20,freeBytes:Number.MAX_SAFE_INTEGER,pendingBytes:12,pendingWrites:1};
  const noSpace=createImageCache(directory,limits);
  expect(await noSpace.put(key(6),new Uint8Array(12))).toBe(false);
  limits.freeBytes=0;expect(await noSpace.put(key(6),new Uint8Array(12))).toBe(true);
 }finally{delete globals[diskBoundary];await rm(directory,{recursive:true,force:true});}
});

test('pending operation count also bounds zero-byte cache writes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'coast-cache-count-'));
 try{
  const gate=deferred<void>(),started=deferred<void>();
  globals[diskBoundary]=(async(...args:Parameters<typeof writeFile>)=>{started.resolve();await gate.promise;await writeFile(...args);}) as typeof writeFile;
  const cache=createImageCache(directory,{bytes:100,files:20,freeBytes:0,pendingBytes:12,pendingWrites:1});
  const first=cache.put(key(1),new Uint8Array(0));await started.promise;
  expect(await cache.put(key(2),new Uint8Array(0))).toBe(false);
  gate.resolve();expect(await first).toBe(true);expect(await cache.put(key(2),new Uint8Array(0))).toBe(true);
 }finally{delete globals[diskBoundary];await rm(directory,{recursive:true,force:true});}
});

type ArtworkFixture={get:()=>Promise<Uint8Array|null>;put:()=>Promise<boolean>;fetch:(init:RequestInit)=>Promise<Response>};
const artworkBoundary=Symbol.for('coast.test.tmdb-lifecycle');
const artworkGlobals=globalThis as typeof globalThis & {[artworkBoundary]?:ArtworkFixture};
let specimen=0;
async function tmdb(fixture:ArtworkFixture){
 artworkGlobals[artworkBoundary]=fixture;
 const source=withArtworkFlights(await Bun.file(new URL('../src/lib/providers/tmdb/artwork.server.ts',import.meta.url)).text())
 .replace("import { createImageCache } from '$lib/server/storage/image-cache.server';",`const createImageCache=()=>globalThis[Symbol.for('coast.test.tmdb-lifecycle')];`)
 .replace("import { getConfig } from '$lib/server/config';",'const getConfig=async()=>({cacheTmdbArtwork:true});')
 .replace("import { dataDirectory } from '$lib/server/security/credentials';",'const dataDirectory=()=>"/synthetic";')
 .replace("import { secureProviderFetch } from '$lib/server/security/provider-fetch';",`const secureProviderFetch=(_config,_path,init)=>globalThis[Symbol.for('coast.test.tmdb-lifecycle')].fetch(init);`);
 return await import(compile(source+`\nexport const specimen=${specimen++};`)) as typeof import('../src/lib/providers/tmdb/artwork.server');
}
const image=()=>new Response(new Uint8Array([255,216,255,0]),{headers:{'content-type':'image/jpeg'}});
const request=(signal?:AbortSignal)=>new Request('https://fixture.invalid/artwork',{signal});
const turn=()=>new Promise(resolve=>setTimeout(resolve,0));

test('TMDB skips cancelled cache work and still delivers when optional persistence declines',async()=>{
 let calls=0,reads=0;
 const pendingRead=deferred<Uint8Array|null>();
 const module=await tmdb({get:async()=>{reads++;return pendingRead.promise;},put:async()=>false,fetch:async()=>{calls++;return image();}});
 try{
  const aborted=new AbortController();aborted.abort();
  await expect(module.streamTmdbArtwork('w342','fixture.jpg',request(aborted.signal))).rejects.toThrow();expect(reads).toBe(0);expect(calls).toBe(0);
  const controller=new AbortController(),reading=module.streamTmdbArtwork('w342','fixture.jpg',request(controller.signal));
  await turn();controller.abort();pendingRead.resolve(null);
  await expect(reading).rejects.toThrow();expect(calls).toBe(0);
  const response=await module.streamTmdbArtwork('w342','fixture.jpg',request());
  expect(response.status).toBe(200);expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([255,216,255,0]));expect(calls).toBe(1);
 }finally{delete artworkGlobals[artworkBoundary];}
});

test('server artwork also delivers its authorised image when shared cache persistence declines',async()=>{
 const source=withArtworkFlights(await Bun.file(new URL('../src/lib/providers/server-artwork.server.ts',import.meta.url)).text())
 .replace("import { createImageCache } from '$lib/server/storage/image-cache.server';",'const createImageCache=()=>({get:async()=>null,put:async()=>false});')
 .replace("import { getConfig } from '$lib/server/config';",'const getConfig=async()=>({cacheServerArtwork:true});')
 .replace("import { dataDirectory } from '$lib/server/security/credentials';",'const dataDirectory=()=>"/synthetic";');
 const {serverArtwork}:typeof import('../src/lib/providers/server-artwork.server')=await import(compile(source));
 const bytes=new Uint8Array([82,73,70,70,0,0,0,0,87,69,66,80]);
 const response=await serverArtwork(['authorised','fixture'],async()=>new Response(bytes,{headers:{'content-type':'image/webp'}}),new AbortController().signal);
 expect(response.status).toBe(200);expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
});

test('TMDB cancels individual waiters and aborts upstream only after the last consumer leaves',async()=>{
 const download=deferred<Response>();let calls=0,signal:AbortSignal|undefined;
 const module=await tmdb({get:async()=>null,put:async()=>true,fetch:async init=>{calls++;signal=init.signal!;return download.promise;}});
 try{
  const a=new AbortController(),b=new AbortController();
  const first=module.streamTmdbArtwork('w342','same.jpg',request(a.signal)),second=module.streamTmdbArtwork('w342','same.jpg',request(b.signal));
  const firstRejected=first.then(()=>false,()=>true);await turn();expect(calls).toBe(1);
  a.abort();expect(await firstRejected).toBe(true);expect(signal?.aborted).toBe(false);
  download.resolve(image());expect((await second).status).toBe(200);expect(signal?.aborted).toBe(false);
 }finally{delete artworkGlobals[artworkBoundary];}
});

test('last TMDB cancellation permits retry, old completion cannot remove replacement, and cancelling work retains its four-slot credit',async()=>{
 const downloads:{gate:ReturnType<typeof deferred<Response>>;signal:AbortSignal}[]=[];
 const module=await tmdb({get:async()=>null,put:async()=>true,fetch:async init=>{const gate=deferred<Response>();downloads.push({gate,signal:init.signal!});return gate.promise;}});
 try{
  const controller=new AbortController();
  const old=module.streamTmdbArtwork('w342','same.jpg',request(controller.signal)),oldRejected=old.then(()=>false,()=>true);
  await turn();controller.abort();expect(await oldRejected).toBe(true);expect(downloads[0].signal.aborted).toBe(true);
  const retry=module.streamTmdbArtwork('w342','same.jpg',request());await turn();expect(downloads).toHaveLength(2);
  downloads[0].gate.reject(new DOMException('Cancelled','AbortError'));await turn();
  const otherWaiter=module.streamTmdbArtwork('w342','same.jpg',request());await turn();expect(downloads).toHaveLength(2);
  downloads[1].gate.resolve(image());expect((await retry).status).toBe(200);expect((await otherWaiter).status).toBe(200);
  const controllers=Array.from({length:4},()=>new AbortController());
  const pending=controllers.map((item,i)=>module.streamTmdbArtwork('w342',`slot-${i}.jpg`,request(item.signal)));
  const rejected=pending.map(item=>item.then(()=>false,()=>true));await turn();
  controllers.forEach(item=>item.abort());expect(await Promise.all(rejected)).toEqual([true,true,true,true]);
  expect((await module.streamTmdbArtwork('w342','saturated.jpg',request())).status).toBe(302);
  for(const item of downloads.slice(2))item.gate.reject(new DOMException('Cancelled','AbortError'));
  await turn();
  const fresh=module.streamTmdbArtwork('w342','fresh.jpg',request());await turn();downloads.at(-1)!.gate.resolve(image());expect((await fresh).status).toBe(200);
 }finally{delete artworkGlobals[artworkBoundary];}
});
