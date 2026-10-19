import {expect,test} from 'bun:test';

test('closed menus own no breakpoint listeners and nested menus use the current mode on first open',async()=>{
 const child=Bun.spawn([process.execPath,'run','tests/fixtures/menu-lifecycle.ts'],{stdout:'pipe',stderr:'pipe'});
 const [status,output,errors]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
 expect({status,errors}).toEqual({status:0,errors:''});
 expect(JSON.parse(output)).toEqual({closedMediaListeners:0,nestedOpenMediaListeners:2,closedModeFresh:true,focusRestored:true,remainingResources:0});
});
