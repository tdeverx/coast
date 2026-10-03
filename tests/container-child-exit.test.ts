import {expect,test} from 'bun:test';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
async function write(directory:string,child:string,code:string,signal=''){
 const status=await Bun.spawn([process.execPath,'scripts/container-child-exit.ts',directory,child,'123',code,signal],{env:{...process.env,COAST_BUILD_ID:'fixture-build'},stdout:'pipe',stderr:'pipe'}).exited;
 expect(status).toBe(0);
}
test('lifecycle record preserves exit identity/status/signals and rotates independently of stdout',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'coast-child-exit-test-'));
 try{
  await write(directory,'application','7');
  let records=(await Bun.file(join(directory,'runtime/child-exits.jsonl')).text()).trim().split('\n').map(line=>JSON.parse(line));
  expect(records[0]).toMatchObject({child:'application',pid:123,exitCode:7,signalNumber:null,terminationSignal:null,build:'fixture-build'});
  expect((await stat(join(directory,'runtime/child-exits.jsonl'))).mode&0o777).toBe(0o600);
  await write(directory,'termination','143','TERM');
  records=(await Bun.file(join(directory,'runtime/child-exits.jsonl')).text()).trim().split('\n').map(line=>JSON.parse(line));
  expect(records[1]).toMatchObject({child:'termination',exitCode:143,signalNumber:15,terminationSignal:'TERM'});
  await Bun.write(join(directory,'runtime/child-exits.jsonl'),'x'.repeat(65537));
  await write(directory,'database','1');
  expect((await stat(join(directory,'runtime/child-exits.jsonl.1'))).size).toBe(65537);
  expect(JSON.parse((await Bun.file(join(directory,'runtime/child-exits.jsonl')).text()).trim()).child).toBe('database');
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('lifecycle diagnostic failure never replaces the child exit with a failed write',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'coast-child-exit-test-'));
 try{await Bun.write(join(directory,'blocked'),'file');await write(join(directory,'blocked'),'application','9');}
 finally{await rm(directory,{recursive:true,force:true});}
});
