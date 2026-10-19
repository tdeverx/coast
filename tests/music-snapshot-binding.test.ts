import {expect,test} from 'bun:test';
import {sql} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/bun-sql';
import {providerItems} from '../src/lib/server/db/schema';

// Compile the real persistence statement through the installed dialect and
// native Bun JSONB codec. No database, provider response or transport is mocked.
const source=await Bun.file(new URL('../src/lib/music/persistence.server.ts',import.meta.url)).text();
const statement=source.match(/const \[saved\]=await (tx\.insert\(providerItems\)[^\n]*?\.returning\(\));/)?.[1];
if(!statement)throw Error('Review music provider-item upsert source before updating its binding contract.');
const compile=new Function('tx','providerItems','sql','instanceId','externalId','id','kind','snapshot','Date',
  `return ${statement}.toSQL();`);

test('rich music upsert binds native snapshot once and keeps both observation timestamps',()=>{
  const clock=Date.UTC(2026,9,18),ids=Array.from({length:2},()=>crypto.randomUUID());
  for(const snapshot of [{id:ids[0],kind:'track',title:'Literal " JSON / 音楽',artists:[],externalIds:{},genres:['A','A']},
    {id:ids[0],kind:'album',title:'Album',artists:[{id:ids[1],name:'Artist'}],externalIds:{musicbrainzreleasegroup:ids[1]},genres:[]}]){
    let time=clock;
    class ObservationDate extends Date{constructor(){super(time++);}}
    const query=compile(drizzle.mock(),providerItems,sql,ids[0],ids[1],ids[1],snapshot.kind,snapshot,ObservationDate);
    const objects=query.params.filter((value:unknown)=>value!==null&&typeof value==='object');
    expect(objects).toEqual([snapshot]);
    expect(objects[0]).toBe(snapshot);
    expect(query.params).toContain(new Date(clock).toISOString());
    expect(query.params).toContain(new Date(clock+1).toISOString());
    expect(time).toBe(clock+2);
    expect(query.sql).toContain('"snapshot" = excluded.snapshot');
  }
});
