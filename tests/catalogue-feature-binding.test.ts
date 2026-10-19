import {expect,test} from 'bun:test';
import {sql} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/bun-sql';
import {workFeatures} from '../src/lib/server/db/schema';

// Compile the actual guarded owner statement using the installed dialect and
// native Bun JSONB codec. These authored values are driver contracts, not DB cohorts.
const source=await Bun.file(new URL('../src/lib/catalogue/service.server.ts',import.meta.url)).text();
const statement=source.match(/if\(metadata\.tasteFeatures!==undefined\)await tx\.insert\(workFeatures\)[^\n]*;/)?.[0];
if(!statement)throw Error('Review catalogue feature admission before updating its binding contract.');
const compile=new Function('tx','workFeatures','sql','mediaId','metadata','Date',
  statement.replace('await ','return ').replace(/;$/,'.toSQL();'));

test('catalogue features bind defined values once and preserve independent conflict observation time',()=>{
  const clock=Date.UTC(2026,9,18),mediaId=crypto.randomUUID();
  for(const features of [{},{tags:[{id:'literal',name:'Literal " JSON / 音楽'}],writers:[],cast:[]}]){
    let calls=0;
    class ObservationDate extends Date{constructor(){super(clock+calls++);}}
    const metadata={provider:'tmdb',tasteFeatures:features};
    const query=compile(drizzle.mock(),workFeatures,sql,mediaId,metadata,ObservationDate);
    const objects=query.params.filter((value:unknown)=>value!==null&&typeof value==='object');
    expect(objects).toEqual([features]);
    expect(objects[0]).toBe(features);
    expect(query.sql).toContain('"features" = excluded.features');
    expect(query.sql.split(' on conflict ')[0]).toEndWith(', default)');
    expect(query.params).toContain(new Date(clock).toISOString());
    expect(calls).toBe(1);
  }
});

test('catalogue omitted features admit no insert or conflict timestamp',()=>{
  let insertCalls=0,dateCalls=0;
  const tx={insert(){insertCalls++;throw Error('Omitted features must not write.');}};
  class ObservationDate extends Date{constructor(){super(0);dateCalls++;}}
  for(const metadata of [{provider:'tmdb'},{provider:'tmdb',tasteFeatures:undefined}]){
    expect(compile(tx,workFeatures,sql,crypto.randomUUID(),metadata,ObservationDate)).toBeUndefined();
  }
  expect(insertCalls).toBe(0);
  expect(dateCalls).toBe(0);
});
