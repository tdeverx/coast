import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createImageCache } from '#lib/server/storage/image-cache.server.js';
import { dataDirectory } from '#lib/server/security/credentials.js';
import { getConfig } from '#lib/server/config.js';
import { createArtworkFlights } from './artwork-flight.server';
const flights=createArtworkFlights();
const caches=new Map<string,ReturnType<typeof createImageCache>>();
function valid(bytes:Uint8Array){return bytes.length>=12 && String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP';}
/** Call only after the relay verifies this account's current authorization/access. */
export async function serverArtwork(scope:string[],download:(signal:AbortSignal)=>Promise<Response>,signal:AbortSignal):Promise<Response>{
 signal.throwIfAborted();
 const enabled=(await getConfig()).cacheServerArtwork;
 signal.throwIfAborted();
 const directory=join(dataDirectory(),'artwork','servers');
 const key=createHash('sha256').update(JSON.stringify(scope)).digest('hex')+'.image';
 let cache=caches.get(directory);
 if(enabled && !cache){cache=createImageCache(directory);caches.set(directory,cache);}
 let bytes:Uint8Array|null=enabled?await cache!.get(key,valid):null;
 signal.throwIfAborted();
 if(!bytes){
   const fetchBytes=async(ownedSignal:AbortSignal)=>{
     ownedSignal.throwIfAborted();
     const response=await download(ownedSignal);
     if(ownedSignal.aborted){await response.body?.cancel();ownedSignal.throwIfAborted();}
     if(!response.ok || !response.headers.get('content-type')?.startsWith('image/')){await response.body?.cancel();return null;}
     const fetched=new Uint8Array(await response.arrayBuffer());
     ownedSignal.throwIfAborted();
     if(!valid(fetched))return null;
     if(enabled && (await getConfig()).cacheServerArtwork){ownedSignal.throwIfAborted();await cache!.put(key,fetched);}
     return fetched;
   };
   if(enabled){
     const pendingKey=directory+'/'+key;
     bytes=await flights.run(pendingKey,signal,fetchBytes);
   }else bytes=await fetchBytes(signal);
   signal.throwIfAborted();
   if(!bytes)return new Response('Image unavailable.',{status:404});
 }
 signal.throwIfAborted();
 return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'image/webp','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}});
}
