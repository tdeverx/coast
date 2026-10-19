import {expect,test} from 'bun:test';

test('physical comic/PDF sources preserve pages, cancel pending resources and retry failed decodes',async()=>{
 const child=Bun.spawn([process.execPath,'run','tests/fixtures/reader-lifecycle.ts'],{
  stdout:'pipe',stderr:'pipe',env:{...process.env,COAST_DB_TEST:'0'},
 });
 const [status,output,errors]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
 expect({status,errors}).toEqual({status:0,errors:''});
 expect(JSON.parse(output)).toEqual({comicCases:4,archiveCases:3,pdfCases:4});
});
