import {expect,test} from 'bun:test';
import {sql} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/bun-sql';
import {workFeatures} from '../src/lib/server/db/schema';

// Compile the shared owner's real statement through the installed dialect and
// native Bun JSONB codec. These authored driver cases are not actual-data cohorts.
const source=await Bun.file(new URL('../src/lib/catalogue/reading.server.ts',import.meta.url)).text();
const statement=source.match(/await (tx\.insert\(workFeatures\)[\s\S]*?);/)?.[1];
if(!statement)throw Error('Review reading work-feature upsert source before updating its binding contract.');
const compile=new Function('tx','workFeatures','sql','workId','input','features','Date',
  `return ${statement}.toSQL();`);

test('reading features bind once, retain no-op predicate and independently sample both timestamps',()=>{
  const clock=Date.UTC(2026,9,18),workId=crypto.randomUUID(),input={provider:'comic-vine'};
  for(const features of [{genres:[],tags:[],writers:[]},
    {genres:[{id:'literal',name:'Literal " JSON / 文字'}],tags:[],writers:[{id:'writer',name:'Writer'}],
      franchises:[{id:'series',name:'Series'}]}]){
    let time=clock;
    class ObservationDate extends Date{constructor(){super(time++);}}
    const query=compile(drizzle.mock(),workFeatures,sql,workId,input,features,ObservationDate);
    const objects=query.params.filter((value:unknown)=>value!==null&&typeof value==='object');
    expect(objects).toEqual([features]);
    expect(objects[0]).toBe(features);
    expect(query.sql).toContain('"features" = excluded.features');
    expect(query.sql).toContain('"work_features"."features" is distinct from excluded.features');
    expect(query.params).toContain(new Date(clock).toISOString());
    expect(query.params).toContain(new Date(clock+1).toISOString());
    expect(time).toBe(clock+2);
  }
});
