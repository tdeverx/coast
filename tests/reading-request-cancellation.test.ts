import {expect,test} from 'bun:test';

test('reading preparation and file delivery cancel their queued permission lookup',async()=>{
 const child=Bun.spawn([process.execPath,'run','tests/fixtures/reading-request-cancellation.ts'],{stdout:'pipe',stderr:'pipe',env:{...process.env,COAST_DB_TEST:'0'}});
 const [status,output,errors]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
 expect({status,errors}).toEqual({status:0,errors:''});
 expect(JSON.parse(output)).toEqual({queuedCases:2,activeCases:1,alreadyCancelledCases:2,identityCases:2,metadataExecutions:0,downloads:0});
});
