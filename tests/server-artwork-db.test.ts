import {test,expect,beforeAll,afterAll} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import {getConfig} from '../src/lib/server/config';
import {updateConfig} from '../src/lib/application/configuration.server';
import {serverArtwork} from '../src/lib/providers/server-artwork.server';
import type {SessionUser} from '../src/lib/server/auth';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
const id=crypto.randomUUID();let admin:SessionUser;
beforeAll(async()=>{if(process.env.COAST_DB_TEST!=='1')return;await getSql()`insert into users(id,username,role) values(${id},${'cache-'+id},'admin')`;admin={id,username:'Cache fixture',role:'admin',settings:{}} as SessionUser;});
afterAll(async()=>{if(process.env.COAST_DB_TEST==='1')await getSql()`delete from users where id=${id}`;});
run('media server caching is opt-in, deduplicates reads, and scopes images by account generation',async()=>{
 let calls=0;const download=async()=>{calls++;return new Response('RIFF1234WEBPfixture',{headers:{'content-type':'image/webp'}});};
 const scope=[crypto.randomUUID(),'account','generation'];
 await updateConfig(admin,{...await getConfig(),cacheServerArtwork:false});
 await serverArtwork(scope,download);await serverArtwork(scope,download);expect(calls).toBe(2);
 await updateConfig(admin,{...await getConfig(),cacheServerArtwork:true});
 await Promise.all([serverArtwork(scope,download),serverArtwork(scope,download)]);expect(calls).toBe(3);
 await serverArtwork(scope,download);expect(calls).toBe(3);
 await serverArtwork([...scope,'replacement-generation'],download);expect(calls).toBe(4);
 await updateConfig(admin,{...await getConfig(),cacheServerArtwork:false});await serverArtwork(scope,download);expect(calls).toBe(5);
});
run('invalid image responses are never retained',async()=>{
 await updateConfig(admin,{...await getConfig(),cacheServerArtwork:true});let calls=0;
 const download=async()=>{calls++;return new Response('not an image',{headers:{'content-type':'image/webp'}});},scope=[crypto.randomUUID()];
 expect((await serverArtwork(scope,download)).status).toBe(404);expect((await serverArtwork(scope,download)).status).toBe(404);expect(calls).toBe(2);
});
