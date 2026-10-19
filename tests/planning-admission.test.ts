import {expect,test} from 'bun:test';

test('planning retains raw admission limits, ordered stored friends and a fresh transactional recheck',async()=>{
 const child=Bun.spawn([process.execPath,'run','tests/fixtures/planning-admission.ts'],{stdout:'pipe',stderr:'pipe',env:{...process.env,COAST_DB_TEST:'0'}});
 const [status,output,errors]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
 expect({status,errors}).toEqual({status:0,errors:''});
 const result=JSON.parse(output);
 expect(result.databaseConnections).toBe(0);expect(result.cases).toHaveLength(8);
 expect(result.cases.slice(0,3).map((entry:{allowed:boolean;storedFriends:number})=>({allowed:entry.allowed,storedFriends:entry.storedFriends}))).toEqual([{allowed:true,storedFriends:2},{allowed:true,storedFriends:3},{allowed:true,storedFriends:0}]);
 expect(result.cases.slice(3).every((entry:{allowed:boolean})=>!entry.allowed)).toBe(true);
});
