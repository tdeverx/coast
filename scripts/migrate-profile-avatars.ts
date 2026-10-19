import {and,asc,eq,gt,sql} from 'drizzle-orm';
import {getDb,closeDb} from '../src/lib/server/db';
import {users} from '../src/lib/server/db/schema';
import {avatarImage,storeAvatar,pruneUnusedAvatars,stopAvatarSweep} from '../src/lib/core/profile/avatar-storage.server';

/** Operator-only, restartable conversion; no schema/history rewrite or provider I/O.
 * Files are atomically installed before publishing their URL under the same user lock.
 * A rollback can leave an unreachable asset; the existing prune owner removes it.
 */
export async function externalizeProfileAvatars(apply=false) {
 const db=getDb(),result={checked:0,converted:0,unchanged:0,inlineJsonBytes:0,urlJsonBytes:0};
 let after:string|undefined;
 while(true){
  const rows=await db.select({id:users.id}).from(users).where(and(
   sql`${users.settings}#>>'{profile,avatar}' like 'data:image/%'`,after?gt(users.id,after):undefined,
  )).orderBy(asc(users.id)).limit(100);
  if(!rows.length)break;
  for(const row of rows){
   const changed=await db.transaction(async tx=>{
    await tx.execute(sql`SET LOCAL statement_timeout='30s'`);
    await tx.execute(sql`SET LOCAL lock_timeout='5s'`);
    const query=tx.select({settings:users.settings}).from(users).where(eq(users.id,row.id));
    const [user]=await (apply?query.for('update'):query);
    const avatar=user?.settings.profile?.avatar;
    if(typeof avatar!=='string'||!avatar.startsWith('data:image/')){result.unchanged++;return false;}
    const image=avatarImage(avatar);result.checked++;
    // This is a JSON string-size proxy; compressed HTTP and browser caching are separate.
    result.inlineJsonBytes+=Buffer.byteLength(JSON.stringify(avatar));
    const hash=new Bun.CryptoHasher('sha256').update(image.bytes).digest('hex');
    const expected=`/api/v1/profile/avatar/${row.id}/${hash}`;
    result.urlJsonBytes+=Buffer.byteLength(JSON.stringify(expected));
    if(!apply)return false;
    const url=await storeAvatar(row.id,image);
    if(url!==expected)throw Error('Avatar storage identity changed.');
    await tx.update(users).set({settings:{...user.settings,profile:{...user.settings.profile,avatar:url}}}).where(eq(users.id,row.id));
    return true;
   });
   if(changed)result.converted++;
  }
  after=rows.at(-1)!.id;
 }
 return result;
}
if(import.meta.main){
 const mode=process.argv[2];
 if(!['--check','--apply','--prune'].includes(mode))throw Error('Use --check, --prune, or the explicitly approved --apply rollout.');
 try{
  if(mode==='--prune'){let removed=0,scanned=0,result;do{result=await pruneUnusedAvatars();removed+=result.removed;scanned+=result.scanned;}while(result.more&&!result.skipped);console.log(JSON.stringify({removed,scanned,retry:!!result.skipped}));}
  else console.log(JSON.stringify(await externalizeProfileAvatars(mode==='--apply')));
 }finally{await stopAvatarSweep();await closeDb();}
}
