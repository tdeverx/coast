import {expect,test} from 'bun:test';
import {mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DiagnosticStore,storageLimits,diagnosticStore} from '../src/lib/server/diagnostics';
import {applyDiagnosticConfig,defaultConfig,parseConfig} from '../src/lib/server/config';

const event=(ageDays=0,status=200)=>JSON.stringify({createdAt:new Date(Date.now()-ageDays*86400_000).toISOString(),level:'info',kind:'request.complete',correlationId:crypto.randomUUID(),detail:{status,password:'private'}})+'\n';

test('diagnostic retention defaults, validation and runtime configuration use the saved policy',()=>{
  expect(parseConfig({})).toMatchObject({diagnosticMaxSizeMiB:256,diagnosticMaxAgeDays:7});
  for(const patch of [{diagnosticMaxSizeMiB:3},{diagnosticMaxSizeMiB:4097},{diagnosticMaxSizeMiB:4.5},{diagnosticMaxAgeDays:0},{diagnosticMaxAgeDays:366},{diagnosticMaxAgeDays:'7'}])expect(()=>parseConfig(patch)).toThrow();
  const previous={...diagnosticStore.retention},level=diagnosticStore.level;
  try{
    applyDiagnosticConfig({...defaultConfig,diagnosticLevel:'debug',diagnosticMaxSizeMiB:32,diagnosticMaxAgeDays:30});
    expect(diagnosticStore.level).toBe('debug');expect(diagnosticStore.retention).toEqual({maxSizeMiB:32,maxAgeDays:30});
  }finally{diagnosticStore.level=level;diagnosticStore.configure(previous);}
});

test('increased storage retains more segments and lowering the cap prunes oldest files after restart',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'coast-log-size-')),store=new DiagnosticStore(()=>directory);
  store.configure({maxSizeMiB:6,maxAgeDays:7});
  try{
    for(let i=0;i<9;i++){
      await writeFile(join(directory,'0.jsonl'),'x'.repeat(storageLimits.segmentBytes));
      await store.write('info','request.complete',{status:200+i});
    }
    expect((await readdir(directory)).length).toBe(6);
    const restarted=new DiagnosticStore(()=>directory);restarted.configure({maxSizeMiB:4,maxAgeDays:7});
    await restarted.write('info','request.complete',{status:220});
    expect((await readdir(directory)).sort()).toEqual(['0.jsonl','1.jsonl','2.jsonl','3.jsonl']);
    const sizes=await Promise.all((await readdir(directory)).map(async name=>(await stat(join(directory,name))).size));
    expect(sizes.reduce((a,b)=>a+b,0)).toBeLessThanOrEqual(4*storageLimits.segmentBytes);
    expect((await restarted.recent(1))[0].detail.status).toBe(220);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('saved age applies to reads, downloads and subsequent writes immediately',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'coast-log-age-')),store=new DiagnosticStore(()=>directory);
  try{
    store.configure({maxSizeMiB:4,maxAgeDays:30});
    await writeFile(join(directory,'1.jsonl'),event(10,201));
    await writeFile(join(directory,'0.jsonl'),event(1,202));
    expect((await store.recent()).map(row=>row.detail.status)).toEqual([202,201]);
    store.configure({maxSizeMiB:4,maxAgeDays:2});
    await store.write('info','request.complete',{status:203});
    expect(await readdir(directory)).toEqual(['0.jsonl']);
    expect((await store.recent()).map(row=>row.detail.status)).toEqual([203,202]);
    const chunks=[];for await(const chunk of store.download())chunks.push(chunk);
    expect(chunks.join('')).not.toContain('private');
    expect(chunks.join('').trim().split('\n').map(line=>JSON.parse(line).detail.status)).toEqual([203,202]);
    expect(await readFile(join(directory,'0.jsonl'),'utf8')).toContain('private');
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('exports stream one segment at a time and bounded reads sort across segments',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'coast-log-export-')),store=new DiagnosticStore(()=>directory);
  store.configure({maxSizeMiB:4,maxAgeDays:7});
  try{
    await writeFile(join(directory,'0.jsonl'),event(2,200));
    await writeFile(join(directory,'1.jsonl'),event(1,201));
    expect((await store.recent(1)).map(row=>row.detail.status)).toEqual([201]);
    const chunks=store.download();expect((await chunks.next()).value).toContain('"status":200');
    expect((await chunks.next()).value).toContain('"status":201');expect((await chunks.next()).done).toBe(true);
  }finally{await rm(directory,{recursive:true,force:true});}
});
