import {expect,test} from 'bun:test';
import {moduleUrl,eraseTypeScript} from './fixtures/ui-script';
const ids=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
const stubUrl=moduleUrl(`
 export const ids=${JSON.stringify(ids)},calls=[];
 export const getFeatureConfig=async()=>({features:{screen:true},featuredHeroIds:ids});
 export const mediaViewsForIds=async(user,requested)=>{calls.push(['hydrate',user,requested]);return [{id:ids[2],kind:'season'},{id:ids[0],kind:'episode'},{id:ids[3],kind:'book'}];};
 export const nextPlayable=async(user,item)=>{calls.push(['next',user,item.id]);return {id:'playable-'+item.id};};
 export const continueHeroId=()=>{throw Error('Featured items must bypass automatic selection');};
 export const getDb=()=>{throw Error('No per-feature query');};
 export const eq=()=>{},desc=()=>{},sql=()=>{},rewatchFields=()=>{},permittedAvailability=()=>{},isHeroTitle=()=>true;
`);
const source=(await Bun.file('src/lib/server/queries/home.ts').text()).replaceAll(/from ['"][^'"]+['"]/g,`from ${JSON.stringify(stubUrl)}`);
const {homeData}=await import(moduleUrl(eraseTypeScript(source))),stub=await import(stubUrl);
test('featured home heroes keep exact episode/season identity and editorial order in one hydration batch',async()=>{
 const data=await homeData('viewer');
 expect(data.heroes.map((item:any)=>item.id)).toEqual([ids[0],ids[2]]);
 expect(data.heroes.map((item:any)=>item.kind)).toEqual(['episode','season']);
 expect(data.heroNext.id).toBe('playable-'+ids[0]);
 expect(stub.calls).toEqual([['hydrate','viewer',ids],['next','viewer',ids[0]]]);
});
