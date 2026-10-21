import {expect,test} from 'bun:test';
import {moduleUrl,eraseTypeScript} from './fixtures/ui-script';
const stubUrl=moduleUrl(`
 export let config={featuredHeroIds:[]},kind='episode',reads=[];
 export const reset=(ids=[],value='episode')=>{config={featuredHeroIds:ids};kind=value;reads.length=0;};
 export const getDb=()=>({select:()=>({from:()=>({where:async id=>{reads.push(id);return kind?[{kind}]:[];}})})});
 export const eq=(column,value)=>value,media={id:'id',kind:'kind'};
 export const changeConfig=async(actor,patch)=>{config={...config,...patch(config)};return config;};
`);
const source=(await Bun.file('src/lib/application/featured-hero.server.ts').text())
 .replace("from 'valibot'",`from ${JSON.stringify(import.meta.resolve('valibot'))}`)
 .replace("from 'drizzle-orm'",`from ${JSON.stringify(stubUrl)}`)
 .replace("from '#lib/server/auth/index.js'",`from ${JSON.stringify(import.meta.resolve('../src/lib/server/auth/index.ts'))}`)
 .replace("from '#lib/server/security/errors.js'",`from ${JSON.stringify(import.meta.resolve('../src/lib/server/security/errors.ts'))}`)
 .replace("from '#lib/server/db/index.js'",`from ${JSON.stringify(stubUrl)}`)
 .replace("from '#lib/server/db/schema.js'",`from ${JSON.stringify(stubUrl)}`)
 .replace("from './configuration.server'",`from ${JSON.stringify(stubUrl)}`);
const {updateFeaturedHero}=await import(moduleUrl(eraseTypeScript(source))),stub=await import(stubUrl);
const actor={id:crypto.randomUUID(),username:'admin',email:null,role:'admin',settings:{}},episode=crypto.randomUUID(),season=crypto.randomUUID();
test('featuring episodes and seasons persists their exact identity, preserves order and avoids duplicates',async()=>{
 stub.reset();await updateFeaturedHero(actor,{mediaId:episode,featured:true});
 stub.reset(stub.config.featuredHeroIds,'season');await updateFeaturedHero(actor,{mediaId:season,featured:true});
 await updateFeaturedHero(actor,{mediaId:episode,featured:true});
 expect(stub.config.featuredHeroIds).toEqual([episode,season]);expect(stub.reads).toEqual([season,episode]);
 await updateFeaturedHero(actor,{mediaId:episode,featured:false});expect(stub.config.featuredHeroIds).toEqual([season]);
 await updateFeaturedHero(actor,{mediaId:season,featured:false});expect(stub.config.featuredHeroIds).toEqual([]);
});
test('featuring requires an admin and an existing screen item, and admission is bounded',async()=>{
 stub.reset();await expect(updateFeaturedHero(null,{mediaId:episode,featured:true})).rejects.toMatchObject({status:401});
 await expect(updateFeaturedHero({...actor,role:'user'},{mediaId:episode,featured:true})).rejects.toMatchObject({status:403});expect(stub.reads).toHaveLength(0);
 stub.reset([],'book');await expect(updateFeaturedHero(actor,{mediaId:episode,featured:true})).rejects.toMatchObject({status:400});
 stub.reset([],null);await expect(updateFeaturedHero(actor,{mediaId:episode,featured:true})).rejects.toMatchObject({status:404});
 const ids=Array.from({length:20},()=>crypto.randomUUID());stub.reset(ids);
 await expect(updateFeaturedHero(actor,{mediaId:episode,featured:true})).rejects.toMatchObject({status:400});expect(stub.config.featuredHeroIds).toEqual(ids);
 // A removed catalogue item can still be unfeatured without a successful metadata lookup.
 stub.reset([episode],null);await updateFeaturedHero(actor,{mediaId:episode,featured:false});expect(stub.reads).toHaveLength(0);expect(stub.config.featuredHeroIds).toEqual([]);
});
