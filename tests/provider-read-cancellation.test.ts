import {expect,test} from 'bun:test';

test('music browse/detail/artwork and trailer routes cancel queued provider work through their real adapter',async()=>{
 const child=Bun.spawn([process.execPath,'run','tests/fixtures/provider-read-cancellation.ts'],{stdout:'pipe',stderr:'pipe',env:{...process.env,COAST_DB_TEST:'0'}});
 const [status,output,errors]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
 expect({status,errors}).toEqual({status:0,errors:''});
 expect(JSON.parse(output)).toEqual({cancelledRoutes:5,providerExecutions:0,observations:0,downloads:0});
});
