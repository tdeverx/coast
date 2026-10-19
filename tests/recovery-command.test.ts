import {expect,test} from 'bun:test';

const recoverySource=await Bun.file(new URL('../scripts/test-recovery.ts',import.meta.url)).text();
const recoveryBody=recoverySource.slice(recoverySource.indexOf('async function child('),recoverySource.indexOf('\ntry{'));
const compile=(source:string)=>new Bun.Transpiler({loader:'ts'}).transformSync(source);

function commands(){
 const children:Bun.Subprocess[]=[];
 const runtime={spawn:(...args:Parameters<typeof Bun.spawn>)=>{const child=Bun.spawn(...args);children.push(child);const watchdog=setTimeout(()=>child.kill('SIGKILL'),2000);void child.exited.then(()=>clearTimeout(watchdog));return child;}};
 const child=new Function('Bun','target',compile(recoveryBody)+';return child;')(runtime,{password:'private-test-password'}) as (args:string[])=>Promise<string>;
 return {child,children,async close(){for(const child of children)if(child.exitCode===null)child.kill('SIGKILL');await Promise.all(children.map(child=>child.exited));}};
}

// These are controlled OS-pipe regressions, not actual-data performance tests.
test('recovery starts both stream readers before either stream reaches EOF',async()=>{
 let release!:()=>void,stderrRead=false;
 const ready=new Promise<void>(resolve=>{release=resolve;}),encoder=new TextEncoder();
 const stdout=new ReadableStream<Uint8Array>({async pull(controller){await ready;controller.enqueue(encoder.encode('output'));controller.close();}},{highWaterMark:0});
 const stderr=new ReadableStream<Uint8Array>({pull(controller){stderrRead=true;release();controller.enqueue(encoder.encode('diagnostic'));controller.close();}},{highWaterMark:0});
 const child=new Function('Bun','target',compile(recoveryBody)+';return child;')({spawn:()=>({stdout,stderr,exited:Promise.resolve(0)})},{password:'private-test-password'});
 const result=child([]);
 try{await Bun.sleep(0);expect(stderrRead).toBe(true);}finally{release();await result;}
 expect(await result).toBe('output');
});

test('recovery drains a saturated stderr pipe while stdout remains open',async()=>{
 const run=commands();
 try{
  const result=await run.child([process.execPath,'-e',`await Bun.write(Bun.stderr,'e'.repeat(2*1024*1024));await Bun.write(Bun.stdout,'o'.repeat(2*1024*1024));`]);
  expect(result).toBe('o'.repeat(2*1024*1024));
  expect(run.children[0].exitCode).toBe(0);
 }finally{await run.close();}
},5000);

test('recovery retains successful stdout and redacts every password in a complete nonzero failure',async()=>{
 const run=commands();
 try{
  expect(await run.child([process.execPath,'-e',`console.error('ordinary diagnostic');console.log('exact output');`])).toBe('exact output\n');
  await expect(run.child([process.execPath,'-e',`await Bun.write(Bun.stderr,'e'.repeat(1024*1024));console.error('private-test-password tail private-test-password');process.exitCode=7;`])).rejects.toThrow(' tail [redacted]');
  try{await run.child([process.execPath,'-e',`console.error('private-test-password tail private-test-password');process.exitCode=9;`]);throw Error('nonzero child accepted');}
  catch(error){expect((error as Error).message).toBe('Recovery drill step failed: [redacted] tail [redacted]\n');}
  expect(run.children.map(child=>child.exitCode)).toEqual([0,7,9]);
 }finally{await run.close();}
},5000);

test('historical verification also drains git stderr without changing its error or source result',async()=>{
 const source=await Bun.file(new URL('../scripts/performance-verification.ts',import.meta.url)).text();
 const body=source.slice(source.indexOf(' const git=Bun.spawn('),source.indexOf('  const baselinePath='));
 const children:Bun.Subprocess[]=[];
 const collect=(status:number)=>new Function('Bun','root','ref',compile(`return (async()=>{${body};return baseline;})();`))({spawn:()=>{
  const child=Bun.spawn([process.execPath,'-e',`await Bun.write(Bun.stderr,'e'.repeat(2*1024*1024));console.log('immutable source');process.exitCode=${status};`],{stdout:'pipe',stderr:'pipe'});children.push(child);const watchdog=setTimeout(()=>child.kill('SIGKILL'),2000);void child.exited.then(()=>clearTimeout(watchdog));return child;
 }},'unused','unused');
 try{
  expect(await collect(0)).toBe('immutable source\n');
  await expect(collect(2)).rejects.toThrow('The immutable baseline source was not found.');
 }finally{for(const child of children)if(child.exitCode===null)child.kill('SIGKILL');await Promise.all(children.map(child=>child.exited));}
},5000);
