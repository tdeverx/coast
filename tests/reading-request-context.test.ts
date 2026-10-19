import {expect,test} from 'bun:test';

test('reading file requests reuse one fresh verified context and retain relay admission',async()=>{
 const child=Bun.spawn([process.execPath,'run','tests/fixtures/reading-request-context.ts'],{stdout:'pipe',stderr:'pipe',env:{...process.env,COAST_DB_TEST:'0'}});
 const [status,output,errors]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
 expect({status,errors}).toEqual({status:0,errors:''});
 const result=JSON.parse(output);
 expect(result.expectedContexts).toBe(1);expect(result.cases).toHaveLength(24);
 expect(result.cases.slice(0,2).map((entry:{selects:unknown;decryptions:number})=>({selects:entry.selects,decryptions:entry.decryptions}))).toEqual(Array.from({length:2},()=>({selects:{reading_sessions:1,users:1,reading_works:1,provider_connections:1,provider_instances:1},decryptions:2})));
});
