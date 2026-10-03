import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createImageCache } from '$lib/server/storage/image-cache.server';
import { dataDirectory } from '$lib/server/security/credentials';
import { getConfig } from '$lib/server/config';
const pending=new Map<string,Promise<Uint8Array|null>>();
const caches=new Map<string,ReturnType<typeof createImageCache>>();
function valid(bytes:Uint8Array){return bytes.length>=12 && String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP';}
/** Call only after the relay verifies this account's current authorization/access. */
export async function serverArtwork(scope:string[],download:()=>Promise<Response>):Promise<Response>{
 const enabled=(await getConfig()).cacheServerArtwork;
 const directory=join(dataDirectory(),'artwork','servers');
 const key=createHash('sha256').update(JSON.stringify(scope)).digest('hex')+'.image';
 let cache=caches.get(directory);
 if(enabled && !cache){cache=createImageCache(directory);caches.set(directory,cache);}
 let bytes:Uint8Array|null=enabled?await cache!.get(key):null;
 if(!bytes || !valid(bytes)){
   const fetchBytes=async()=>{
     const response=await download();
     if(!response.ok || !response.headers.get('content-type')?.startsWith('image/')){await response.body?.cancel();return null;}
     const fetched=new Uint8Array(await response.arrayBuffer());
     if(!valid(fetched))return null;
     if(enabled && (await getConfig()).cacheServerArtwork)await cache!.put(key,fetched);
     return fetched;
   };
   if(enabled){
     const pendingKey=directory+'/'+key;
     let request=pending.get(pendingKey);
     if(!request){request=fetchBytes();pending.set(pendingKey,request);void request.finally(()=>pending.delete(pendingKey)).catch(()=>{});}
     bytes=await request;
   }else bytes=await fetchBytes();
   if(!bytes)return new Response('Image unavailable.',{status:404});
 }

 return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'image/webp','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}});
}
