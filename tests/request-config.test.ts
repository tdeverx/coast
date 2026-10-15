import {expect,test} from 'bun:test';

// Execute the actual module with only its database boundary replaced. An isolated
// data URL avoids globally mocking the shared pool for unrelated unit tests.
const boundary=Symbol.for('coast.test.request-config.sql');
const globals=globalThis as typeof globalThis & {[boundary]?:()=>Promise<{value:Record<string,unknown>}[]>};
const source=(await Bun.file(new URL('../src/lib/server/config.ts',import.meta.url)).text())
  .replace("import { getSql } from './db';",`const getSql=()=>globalThis[Symbol.for('coast.test.request-config.sql')];`)
  .replace("from '../diagnostics'",`from ${JSON.stringify(import.meta.resolve('../src/lib/diagnostics.ts'))}`)
  .replace("from './diagnostics'",`from ${JSON.stringify(import.meta.resolve('../src/lib/server/diagnostics/index.ts'))}`)
  .replace("from 'valibot'",`from ${JSON.stringify(import.meta.resolve('valibot'))}`)
  .replace("from 'drizzle-orm'",`from ${JSON.stringify(import.meta.resolve('drizzle-orm'))}`);
const compiled=new Bun.Transpiler({loader:'ts'}).transformSync(source);
const {getConfig,withRequestConfig,withoutRequestConfig,replaceRequestConfig,defaultConfig}:typeof import('../src/lib/server/config')=
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('request policy reads coalesce once while later requests and unscoped jobs stay fresh',async()=>{
 let count=0,value={...defaultConfig};
 globals[boundary]=async()=>{count++;return [{value:structuredClone(value)}];};
 try {
  await withRequestConfig(async()=>{
   const first=getConfig(),second=getConfig();expect(first).toBe(second);
   expect((await first).experimentalBooks).toBe(false);
   value={...value,experimentalBooks:true};
   expect((await getConfig()).experimentalBooks).toBe(false);
  });
  expect(count).toBe(1);
  expect((await withRequestConfig(()=>getConfig())).experimentalBooks).toBe(true);expect(count).toBe(2);
  value={...value,experimentalBooks:false};expect((await getConfig()).experimentalBooks).toBe(false);
  value={...value,experimentalBooks:true};expect((await getConfig()).experimentalBooks).toBe(true);expect(count).toBe(4);
 }finally{delete globals[boundary];}
});

test('transaction connections bypass snapshots and a committed change replaces only the current request',async()=>{
 globals[boundary]=async()=>[{value:{...defaultConfig}}];
 try {
  await withRequestConfig(async()=>{
   expect((await getConfig()).experimentalComics).toBe(false);
   let explicit=0;
   const transaction=async()=>{explicit++;return [{value:{...defaultConfig,experimentalComics:true}}];};
   expect((await getConfig(transaction as unknown as Parameters<typeof getConfig>[0])).experimentalComics).toBe(true);
   expect((await getConfig(transaction as unknown as Parameters<typeof getConfig>[0])).experimentalComics).toBe(true);expect(explicit).toBe(2);
   expect((await getConfig()).experimentalComics).toBe(false);
   const execute={execute:async()=>[{value:{...defaultConfig,experimentalComics:true}}]};
   expect((await getConfig(execute as unknown as Parameters<typeof getConfig>[0])).experimentalComics).toBe(true);
   replaceRequestConfig({...defaultConfig,experimentalComics:true});
   expect((await getConfig()).experimentalComics).toBe(true);
  });
  expect((await withRequestConfig(()=>getConfig())).experimentalComics).toBe(false);
 }finally{delete globals[boundary];}
});

test('overlapping requests retain independent snapshots and failures cannot poison future requests',async()=>{
 let fail=true,count=0;
 globals[boundary]=async()=>{count++;if(fail)throw new Error('Synthetic settings failure');return [{value:{...defaultConfig}}];};
 try {
  await withRequestConfig(async()=>{
   const first=getConfig(),second=getConfig();expect(first).toBe(second);
   await expect(first).rejects.toThrow('Synthetic settings failure');
  });
  fail=false;await expect(withRequestConfig(()=>getConfig())).resolves.toEqual(defaultConfig);expect(count).toBe(2);
  let release!:()=>void;
  const wait=new Promise<void>(resolve=>{release=resolve;});
  const first=withRequestConfig(async()=>{await getConfig();await wait;return getConfig();});
  const second=withRequestConfig(async()=>{await getConfig();replaceRequestConfig({...defaultConfig,siteAccess:'public-profiles'});release();return getConfig();});
  const [a,b]=await Promise.all([first,second]);expect(a.siteAccess).toBe('private');expect(b.siteAccess).toBe('public-profiles');
 }finally{delete globals[boundary];}
});

test('detached request descendants stop caching when their owning request finishes',async()=>{
 let value={...defaultConfig},reads=0,release!:()=>void,child!:Promise<boolean>;
 const wait=new Promise<void>(resolve=>{release=resolve;});
 globals[boundary]=async()=>{reads++;return [{value:structuredClone(value)}];};
 try{
  await withRequestConfig(async()=>{
   await getConfig();
   child=(async()=>{await wait;return (await getConfig()).experimentalBooks;})();
  });
  value={...value,experimentalBooks:true};release();
  expect(await child).toBe(true);expect(reads).toBe(2);
 }finally{delete globals[boundary];}
});

test('background startup can leave the request scope before its owning response finishes',async()=>{
 let value={...defaultConfig},reads=0;
 globals[boundary]=async()=>{reads++;return [{value:structuredClone(value)}];};
 try{
  await withRequestConfig(async()=>{
   expect((await getConfig()).experimentalBooks).toBe(false);
   value={...value,experimentalBooks:true};
   expect((await withoutRequestConfig(()=>getConfig())).experimentalBooks).toBe(true);
   expect((await getConfig()).experimentalBooks).toBe(false);expect(reads).toBe(2);
  });
 }finally{delete globals[boundary];}
});
