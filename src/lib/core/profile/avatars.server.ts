import {and,eq,inArray} from 'drizzle-orm';
import {getDb} from '$lib/server/db';
import {providerConnections,providerInstances} from '$lib/server/db/schema';
import {getConfig} from '$lib/server/config';
import {getJellyfin} from '$lib/providers/jellyfin/connection.server';
import {getTrakt} from '$lib/providers/trakt/connection.server';
import {jellyfinAuthorization} from '$lib/providers/jellyfin/adapter.server';
import {instanceFetchConfig} from '$lib/providers/instances.server';
import {decryptCredential} from '$lib/server/security/credentials';
import {secureProviderFetch} from '$lib/server/security/provider-fetch';
import {AppError} from '$lib/server/security/errors';

export async function profileAvatarChoices(userId:string){
 const config=await getConfig();
 return getDb().select({id:providerConnections.id,provider:providerInstances.provider,name:providerInstances.name})
  .from(providerConnections).innerJoin(providerInstances,eq(providerInstances.id,providerConnections.instanceId))
  .where(and(eq(providerConnections.userId,userId),eq(providerConnections.status,'connected'),eq(providerInstances.enabled,true),inArray(providerInstances.provider,config.enableTrakt?['jellyfin','trakt']:['jellyfin']))).orderBy(providerInstances.name).limit(60);
}
/** Import only the owner's linked account image. The saved avatar is the existing local image. */
export async function providerProfileAvatar(userId:string,connectionId:string,request:Request){
 const choices=await profileAvatarChoices(userId),choice=choices.find(c=>c.id===connectionId);
 if(!choice)throw new AppError(404,'Connected profile icon not found.');
 let response:Response;
 if(choice.provider==='jellyfin'){
  const {connection,instance}=await getJellyfin(userId,connectionId);
  const credentials=JSON.parse(await decryptCredential(connection.credentials!)) as {accessToken:string};
  response=await secureProviderFetch(await instanceFetchConfig(instance),`/Users/${encodeURIComponent(connection.externalUserId!)}/Images/Primary?format=Webp&width=256&height=256&quality=85`,{headers:{Authorization:jellyfinAuthorization(userId,credentials.accessToken)},signal:request.signal},{maxBytes:5*1024*1024});
 }else{
  const {adapter,connection}=await getTrakt(userId,connectionId),profile=await adapter.profile();
  if(profile.id!==connection.externalUserId)throw new AppError(409,'The connected Trakt account changed.');
  if(!profile.avatar)throw new AppError(404,'This account has no profile icon.');
  let url:URL;try{url=new URL(profile.avatar);}catch{throw new AppError(400,'The service returned an invalid profile icon.');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||!(url.hostname==='trakt.tv'||url.hostname.endsWith('.trakt.tv')||url.hostname==='gravatar.com'||url.hostname.endsWith('.gravatar.com')))throw new AppError(400,'The service returned an unsupported profile icon.');
  response=await secureProviderFetch({baseUrl:url.origin,approved:true,allowedPorts:[443]},url.pathname+url.search,{signal:request.signal},{maxBytes:5*1024*1024});
 }
 if(!response.ok){await response.body?.cancel();throw new AppError(404,'This account has no available profile icon.');}
 const bytes=new Uint8Array(await response.arrayBuffer());
 // Jellyfin converts supported source formats to WebP, except GIF: its image
 // processor deliberately returns GIF bytes unchanged even with format=Webp.
 // Identify the returned bytes rather than trusting the requested format/MIME.
 const signature=String.fromCharCode(...bytes.slice(0,6));
 const type=bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.length>=8&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)?'image/png':bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'?'image/webp':signature==='GIF87a'||signature==='GIF89a'?'image/gif':null;
 if(!type)throw new AppError(400,'The service returned an unsupported image.');
 return new Response(bytes,{headers:{'Content-Type':type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
