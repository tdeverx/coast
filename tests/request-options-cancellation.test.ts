import {expect,test} from 'bun:test';
test('request options route/account/adapter releases queued identity, permission and option work on abort',async()=>{
 const child=Bun.spawn([process.execPath,'run','tests/fixtures/request-options-cancellation.ts'],{stdout:'pipe',stderr:'pipe'});
 const [status,output,errors]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
 expect({status,errors}).toEqual({status:0,errors:''});
 expect(JSON.parse(output)).toEqual({verifiedStages:3,cancelledProviderExecutions:0});
});
