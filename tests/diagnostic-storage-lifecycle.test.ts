import {expect,test} from 'bun:test';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DiagnosticStore,storageLimits} from '../src/lib/server/diagnostics';

test('diagnostic directory permissions, replacement and missing paths recover without losing future writes',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'coast-diagnostic-lifetime-')),directory=join(root,'nested','diagnostics'),store=new DiagnosticStore(()=>directory);
  try{
    await store.write('info','request.complete',{status:200});expect((await fs.stat(directory)).mode&0o7777).toBe(0o700);expect((await fs.stat(join(directory,'0.jsonl'))).mode&0o7777).toBe(0o600);
    await fs.chmod(directory,0o755);await store.write('info','request.complete',{status:201});expect((await fs.stat(directory)).mode&0o7777).toBe(0o700);
    await fs.rm(directory,{recursive:true});await store.write('info','request.complete',{status:202});expect((await store.recent()).map(row=>row.detail.status)).toEqual([202]);
    await fs.rm(directory,{recursive:true});await fs.writeFile(directory,'external replacement');
    await expect(store.write('info','request.complete',{status:203})).resolves.toBeUndefined();expect(store.metrics().diagnosticFailures).toBe(1);expect(await fs.readFile(directory,'utf8')).toBe('external replacement');
    await fs.unlink(directory);await store.write('info','request.complete',{status:204});expect((await store.recent()).map(row=>row.detail.status)).toEqual([204]);expect(store.metrics().diagnosticPending).toBe(0);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('fresh segment accounting observes external size, truncation and rotation on every write',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'coast-diagnostic-accounting-')),store=new DiagnosticStore(()=>root),current=join(root,'0.jsonl'),previous=join(root,'1.jsonl');
  try{
    await store.write('info','request.complete',{status:200});await fs.writeFile(current,'x'.repeat(storageLimits.segmentBytes));
    await store.write('info','request.complete',{status:201});expect((await fs.stat(previous)).size).toBe(storageLimits.segmentBytes);expect(JSON.parse((await fs.readFile(current,'utf8')).trim()).detail.status).toBe(201);
    await fs.writeFile(current,'');await store.write('info','request.complete',{status:202});expect(JSON.parse((await fs.readFile(current,'utf8')).trim()).detail.status).toBe(202);expect((await fs.stat(previous)).size).toBe(storageLimits.segmentBytes);
    await fs.rename(current,previous);await store.write('info','request.complete',{status:203});expect(JSON.parse((await fs.readFile(current,'utf8')).trim()).detail.status).toBe(203);expect(JSON.parse((await fs.readFile(previous,'utf8')).trim()).detail.status).toBe(202);
    expect(store.metrics().diagnosticFailures).toBe(0);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('one queued operation resolves one directory even when the configured callback changes',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'coast-diagnostic-scope-')),one=join(root,'one'),two=join(root,'two');let directory=one,calls=0;
  const store=new DiagnosticStore(()=>{calls++;return directory;});
  try{
    await store.write('info','request.complete',{status:200});expect(calls).toBe(1);directory=two;await store.write('info','request.complete',{status:201});expect(calls).toBe(2);
    expect(JSON.parse((await fs.readFile(join(one,'0.jsonl'),'utf8')).trim()).detail.status).toBe(200);expect(JSON.parse((await fs.readFile(join(two,'0.jsonl'),'utf8')).trim()).detail.status).toBe(201);
    expect((await store.recent()).map(row=>row.detail.status)).toEqual([201]);expect(calls).toBe(3);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('limited diagnostic reads preserve full-tail order and fill past rejected detail',async()=>{
  const directory=await fs.mkdtemp(join(tmpdir(),'coast-diagnostic-admission-')),store=new DiagnosticStore(()=>directory);
  try{
    const base={createdAt:new Date().toISOString(),level:'info',kind:'request.complete',correlationId:crypto.randomUUID()};
    await fs.writeFile(join(directory,'0.jsonl'),[
      {...base,detail:{status:200,password:'must not escape'}},
      {...base,detail:{status:201}},
      {...base,detail:{method:{toString:null}}},
      {...base,detail:{status:202}},
    ].map(row=>JSON.stringify(row)).join('\n')+'\n');
    const all=await store.recent();
    expect(all.map(row=>row.detail.status)).toEqual([202,201,200]);
    expect(JSON.stringify(all)).not.toContain('must not escape');
    for(const limit of [0,1,2,100,Infinity,NaN]){
      expect(await store.recent(limit)).toEqual(all.slice(0,limit));
    }
    expect(store.metrics().diagnosticFailures).toBe(0);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

const moduleUrl=(source:string)=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const filesystemUrl=moduleUrl(`import * as real from 'node:fs/promises';
 export const open=real.open;
 export const counts={stat:0,mkdir:0,chmod:0,appendFile:0,rename:0,unlink:0,readFile:0,readdir:0};
 export const fault={operation:'',path:'',code:''};
 const call=(operation,args)=>{counts[operation]++;if(fault.operation===operation&&fault.path===args[0]){fault.operation='';throw Object.assign(new Error('controlled filesystem failure'),{code:fault.code});}return real[operation](...args);};
 export const stat=(...args)=>call('stat',args),mkdir=(...args)=>call('mkdir',args),chmod=(...args)=>call('chmod',args),appendFile=(...args)=>call('appendFile',args),rename=(...args)=>call('rename',args),unlink=(...args)=>call('unlink',args),readFile=(...args)=>call('readFile',args),readdir=(...args)=>call('readdir',args);`);
const source=await Bun.file(new URL('../src/lib/server/diagnostics/index.ts',import.meta.url)).text();
const code=new Bun.Transpiler({loader:'ts'}).transformSync(source)
 .replace(/(['"])node:fs\/promises\1/u,JSON.stringify(filesystemUrl))
 .replace(/(['"])\.\.\/security\/credentials\1/u,JSON.stringify(moduleUrl('export const dataDirectory=()=>{throw Error("Default directory must not be used in this test");};')))
 .replace(/(['"])\.\.\/\.\.\/diagnostics\1/u,JSON.stringify(new URL('../src/lib/diagnostics.ts',import.meta.url).href));
const controlled=await import(moduleUrl(code)),filesystem=await import(filesystemUrl);

test('warm writes avoid redundant directory setup while a non-missing size error cannot append blindly',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'coast-diagnostic-io-')),directory=join(root,'diagnostics'),store=new controlled.DiagnosticStore(()=>directory);
  const reset=()=>{for(const key of Object.keys(filesystem.counts))filesystem.counts[key]=0;};
  try{
    await store.write('info','request.complete',{status:200});reset();
    await store.write('info','request.complete',{status:201});expect(filesystem.counts).toEqual({stat:2,mkdir:0,chmod:0,appendFile:1,rename:0,unlink:0,readFile:0,readdir:0});
    const before=await fs.readFile(join(directory,'0.jsonl'),'utf8');filesystem.fault.operation='stat';filesystem.fault.path=join(directory,'0.jsonl');filesystem.fault.code='EIO';reset();
    await expect(store.write('info','request.complete',{status:202})).resolves.toBeUndefined();expect(filesystem.counts.appendFile).toBe(0);expect(await fs.readFile(join(directory,'0.jsonl'),'utf8')).toBe(before);expect(store.metrics().diagnosticFailures).toBe(1);
    await store.write('info','request.complete',{status:203});expect((await store.recent()).map((row:{detail:{status:number}})=>row.detail.status).sort()).toEqual([200,201,203]);
    filesystem.fault.operation='appendFile';filesystem.fault.path=join(directory,'0.jsonl');filesystem.fault.code='EIO';await store.write('info','request.complete',{status:204});expect(store.metrics().diagnosticFailures).toBe(2);
    await store.write('info','request.complete',{status:205});expect((await store.recent()).some((row:{detail:{status:number}})=>row.detail.status===205)).toBe(true);expect(store.metrics().diagnosticPending).toBe(0);
  }finally{filesystem.fault.operation='';await fs.rm(root,{recursive:true,force:true});}
});
