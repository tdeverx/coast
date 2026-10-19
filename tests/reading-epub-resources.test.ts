import {expect,test} from 'bun:test';

test('installed EPUB asset/CSS URLs are released per book, including allocations completing after close',async()=>{
 const child=Bun.spawn([process.execPath,'run','tests/fixtures/epub-resources.ts'],{stdout:'pipe',stderr:'pipe'});
 const [status,output,errors]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
 expect({status,errors}).toEqual({status:0,errors:''});
 expect(JSON.parse(output)).toEqual({cycles:5,lateAsset:true,lateCss:true,independentBook:true,actualBookOpen:true});
});
