import {expect,test} from 'bun:test';
import * as v from 'valibot';
import {error} from '@sveltejs/kit';
import {AppError} from '../src/lib/server/security/errors';
import {DomainError} from '../src/lib/core/errors';
const routes=[
 ['src/routes/people/[id]/+page.server.ts','personDetailData'],
 ['src/routes/media/reading-collection/[id]/+page.server.ts','readingGroupDetail'],
 ['src/routes/games/[id]/+page.server.ts','gameDetailData'],
 ['src/routes/music/work/[id]/+page.server.ts','musicDetailData'],
 ['src/routes/music/[connection]/[id]/+page.server.ts','musicSourceDetailData'],
] as const;
const event={params:{id:'00000000-0000-4000-8000-000000000001',connection:'00000000-0000-4000-8000-000000000002'},locals:{user:{id:'viewer'}},url:new URL('http://coast.invalid/'),depends(){}};
for(const [path,loader] of routes){
 const source=new Bun.Transpiler({loader:'ts'}).transformSync(await Bun.file(path).text()).replace(/^import[^;]+;\n?/gm,'').replace('export const load','const load');
 function route(read:()=>unknown){return new Function('error','AppError','DomainError','v',loader,'jellyfinMusicIdSchema','logDiagnostic','classifyFailure',`${source}\nreturn load;`)(error,AppError,DomainError,v,read,v.string(),async()=>{},()=>({}));}
 test(`${path} preserves known HTTP failures and successful detail data`,async()=>{
  for(const status of [403,404])await expect(route(async()=>{throw new AppError(status,'Known detail failure.');})(event)).rejects.toMatchObject({status,body:{message:'Known detail failure.'}});
  const expected={item:{title:'Details'}};expect(await route(async()=>expected)(event)).toBe(expected);
 });
 if(loader!=='personDetailData'&&loader!=='musicSourceDetailData')test(`${path} maps identifier validation to 400 without disguising unexpected errors`,async()=>{
  await expect(route(async()=>v.parse(v.pipe(v.string(),v.uuid()),'invalid'))(event)).rejects.toMatchObject({status:400});
  const failure=new Error('Unexpected failure');await expect(route(async()=>{throw failure;})(event)).rejects.toBe(failure);
 });
}
