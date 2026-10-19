import { createHash } from 'node:crypto';
import { mkdir, writeFile, rename, unlink, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, inArray, asc, and, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { dataDirectory } from '$lib/server/security/credentials';
import { AppError } from '$lib/server/security/errors';
import { requireVisible } from '$lib/social/privacy.server';

export const avatarRequestLimit = 7 * 1024 * 1024;
const directory = () => join(dataDirectory(), 'avatars');
const avatarUrl = (userId: string, hash: string) => `/api/v1/profile/avatar/${userId}/${hash}`;

function gifBytes(avatar: string) {
  const bytes = Buffer.from(avatar.split(',')[1], 'base64');
  const signature = bytes.toString('ascii', 0, 6);
  if (bytes.length < 14 || !['GIF87a', 'GIF89a'].includes(signature) ||
      !bytes.readUInt16LE(6) || !bytes.readUInt16LE(8))
    throw new AppError(400, 'The avatar is not a valid GIF.');
  if (bytes.length > 5 * 1024 * 1024) throw new AppError(400, 'Choose a GIF smaller than 5 MB.');
  return bytes;
}

const formats = ['gif','png','jpeg','webp'] as const;
type AvatarImage = {bytes:Buffer;format:typeof formats[number]};
function imageFormat(bytes:Uint8Array):AvatarImage['format']|undefined {
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))return 'png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpeg';
  const prefix=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length>=12&&prefix.toString('ascii',0,4)==='RIFF'&&prefix.toString('ascii',8,12)==='WEBP')return 'webp';
  if(bytes.length>=14&&['GIF87a','GIF89a'].includes(prefix.toString('ascii',0,6))&&prefix.readUInt16LE(6)&&prefix.readUInt16LE(8))return 'gif';
}
/** Validate and decode once before the account row lock. Preserve existing format limits. */
export function avatarImage(avatar:string):AvatarImage {
  const match=avatar.match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+=*)$/);
  if(!match)throw new AppError(400,'Choose a PNG, JPEG, WebP or GIF avatar.');
  const format=match[1] as AvatarImage['format'];
  if(format==='gif')return {format,bytes:gifBytes(avatar)};
  if(avatar.length>220000)throw new AppError(400,'Choose a smaller image.');
  const bytes=Buffer.from(match[2],'base64');
  if(imageFormat(bytes)!==format)throw new AppError(400,'The avatar is not a valid image.');
  return {format,bytes};
}

/** The existing account row lock serializes replacement, byte storage and pruning. */
export async function storeAvatar(userId:string,image:AvatarImage) {
  const {bytes,format}=image;
  const hash=createHash('sha256').update(bytes).digest('hex');
  await mkdir(directory(),{recursive:true,mode:0o700});
  const path=join(directory(),`${userId}-${hash}.${format}`);
  const temporary=`${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary,bytes,{mode:0o600,flag:'wx'});
    await rename(temporary,path);
  } finally {await unlink(temporary).catch(()=>{});}
  return avatarUrl(userId,hash);
}

/** Delete only the known previous asset, serialized with any newer profile save.
 * Orphans from rolled-back writes belong to the bounded maintenance sweep. */
export async function pruneAvatars(userId:string,previousAvatar:string|null|undefined) {
  const prefix=`/api/v1/profile/avatar/${userId}/`;
  if(!previousAvatar?.startsWith(prefix))return;
  const hash=previousAvatar.slice(prefix.length);
  if(!/^[0-9a-f]{64}$/.test(hash))return;
  await getDb().transaction(async tx => {
    const [user]=await tx.select({avatar:sql<string|null>`${users.settings}#>>'{profile,avatar}'`}).from(users).where(eq(users.id,userId)).for('update');
    if(user?.avatar===previousAvatar)return;
    for(const format of formats){
      try{await unlink(join(directory(),`${userId}-${hash}.${format}`));}
      catch(cause){if((cause as NodeJS.ErrnoException).code!=='ENOENT')throw cause;}
    }
  });
}

export async function streamAvatar(userId:string,hash:string,viewerId:string|null) {
  if(!/^[0-9a-f]{64}$/.test(hash))throw new AppError(404,'Avatar not found.');
  await requireVisible(userId,viewerId,'details');
  const [user]=await getDb().select({id:users.id}).from(users).where(and(eq(users.id,userId),sql`${users.settings}#>>'{profile,avatar}'=${avatarUrl(userId,hash)}`));
  if(!user)throw new AppError(404,'Avatar not found.');
  // The unchanged hash URL resolves at most four bounded format candidates.
  // Every existing GIF follows this same format loop; no legacy route/cache owner.
  for(const format of formats){
    const file=Bun.file(join(directory(),`${userId}-${hash}.${format}`));
    if(!await file.exists())continue;
    if(imageFormat(new Uint8Array(await file.slice(0,14).arrayBuffer()))!==format)throw new AppError(404,'Avatar not found.');
    return new Response(file,{headers:{'Content-Type':`image/${format}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
  throw new AppError(404,'Avatar not found.');
}

// One directory handle and one bounded metadata batch belong to existing retention.
export const avatarSweepEntries=100;
type AvatarSweep={scanned:number;removed:number;skipped:number;more:boolean};
let sweepCursor:Awaited<ReturnType<typeof opendir>>|undefined,sweepEpoch=0;
let sweepPending:Promise<AvatarSweep>|undefined;
async function closeSweepCursor(cursor:Awaited<ReturnType<typeof opendir>>){
  if(sweepCursor===cursor)sweepCursor=undefined;
  await cursor.close().catch(()=>{});
}
async function sweepAvatars():Promise<AvatarSweep>{
  const result:AvatarSweep={scanned:0,removed:0,skipped:0,more:false},epoch=sweepEpoch;
  let cursor=sweepCursor;
  if(!cursor){
    try{cursor=await opendir(directory());}catch(cause){if((cause as NodeJS.ErrnoException).code==='ENOENT')return result;throw cause;}
    if(epoch!==sweepEpoch){await cursor.close();return result;}
    sweepCursor=cursor;
  }
  try{
    const files:{name:string;userId:string;hash:string;temporary:boolean}[]=[];let ended=false;
    while(result.scanned<avatarSweepEntries&&epoch===sweepEpoch){
      const file=await cursor.read();if(!file){ended=true;break;}result.scanned++;
      const match=file.name.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([0-9a-f]{64})\.(gif|png|jpeg|webp)(\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp)?$/);
      if(file.isFile()&&match)files.push({name:file.name,userId:match[1],hash:match[2],temporary:!!match[4]});
    }
    if(epoch!==sweepEpoch){await closeSweepCursor(cursor);return result;}
    if(files.length)await getDb().transaction(async tx=>{
      const ids=[...new Set(files.map(file=>file.userId))].sort();
      // A skipped locked user is distinct from a missing user. Never delete an
      // asset while its writer holds the existing account row lock.
      const known=new Set((await tx.select({id:users.id}).from(users).where(inArray(users.id,ids))).map(row=>row.id));
      const locked=await tx.select({id:users.id,avatar:sql<string|null>`${users.settings}#>>'{profile,avatar}'`}).from(users).where(inArray(users.id,ids)).orderBy(asc(users.id)).for('update',{skipLocked:true});
      const current=new Map(locked.map(row=>[row.id,row.avatar]));
      for(const file of files){
        if(known.has(file.userId)&&!current.has(file.userId)){result.skipped++;continue;}
        if(!file.temporary&&current.get(file.userId)===avatarUrl(file.userId,file.hash))continue;
        try{await unlink(join(directory(),file.name));result.removed++;}catch(cause){if((cause as NodeJS.ErrnoException).code!=='ENOENT')throw cause;}
      }
    });
    if(ended||epoch!==sweepEpoch)await closeSweepCursor(cursor);
    result.more=epoch===sweepEpoch&&(!ended||result.skipped>0);
    return result;
  }catch(cause){await closeSweepCursor(cursor);throw cause;}
}
export function pruneUnusedAvatars(){
  return sweepPending??=sweepAvatars().finally(()=>{sweepPending=undefined;});
}
export async function stopAvatarSweep(){
  sweepEpoch++;const cursor=sweepCursor;sweepCursor=undefined;
  await sweepPending?.catch(()=>{});
  if(cursor)await cursor.close().catch(()=>{});
}
