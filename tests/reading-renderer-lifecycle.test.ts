import {expect,test} from 'bun:test';

test('actual comic/PDF renderers cancel pending resources and skip settled page navigation',async()=>{
 const child=Bun.spawn([process.execPath,'run','tests/fixtures/reader-lifecycle.ts'],{
  stdout:'pipe',stderr:'pipe',env:{...process.env,COAST_DB_TEST:'0'},
 });
 const [status,output,errors]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
 expect({status,errors}).toEqual({status:0,errors:''});
 expect(JSON.parse(output)).toEqual({comicCases:6,pdfCases:3});
});
