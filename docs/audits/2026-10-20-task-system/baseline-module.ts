/** Freeze only the compared owner. Its unchanged domain dependencies remain in
 * the current tree; this is a focused method comparison, not two whole apps. */
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
export async function baselineModule(path:string,ref='9575de2'){
 const root=process.cwd(),result=Bun.spawnSync(['git','show',`${ref}:${path}`],{cwd:root});
 if(result.exitCode!==0)throw new Error('Baseline source unavailable.');
 const folder=await mkdtemp(join(tmpdir(),'coast-task-baseline-'));
 const source=new TextDecoder().decode(result.stdout).replace(/from (['"])(\.[^'"]+)\1/g,(_match,quote,relative)=>`from ${quote}${resolve(dirname(join(root,path)),relative)}${quote}`);
 const file=join(folder,'owner.ts');await Bun.write(file,source);
 return {module:await import(file),cleanup:()=>rm(folder,{recursive:true,force:true}),sourceSha256:Bun.SHA256.hash(source,'hex')};
}
