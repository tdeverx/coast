import {expect,test} from 'bun:test';

test('both video owners release disabled crop samplers without reloading retained sources',async()=>{
 const child=Bun.spawn([process.execPath,'run','tests/fixtures/video-crop-lifecycle.ts'],{stdout:'pipe',stderr:'pipe'});
 const [status,output,errors]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
 expect({status,errors}).toEqual({status:0,errors:''});
 expect(JSON.parse(output)).toEqual({heroLifetime:true,heroPolicyCases:2,playerDisabledCases:8,pendingTimers:0,retainedSource:true});
});
