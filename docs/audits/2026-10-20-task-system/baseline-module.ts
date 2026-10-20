/** Freeze only the compared owner. Its unchanged domain dependencies remain in
 * the current tree; this is a focused method comparison, not two whole apps. */
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
export async function baselineModule(path:string,ref='9575de2'){
 const root=process.cwd(),result=Bun.spawnSync(['git','show',`${ref}:${path}`],{cwd:root});
 if(result.exitCode!==0)throw new Error('Baseline source unavailable.');
 await mkdir(join(root,'.data'),{recursive:true});
 const folder=await mkdtemp(join(root,'.data/coast-task-baseline-'));
 const source=new TextDecoder().decode(result.stdout).replace(/(['"])\$lib\/([^'"]+)\1/g,(_match,quote,relative)=>`${quote}${join(root,'src/lib',relative)}${quote}`).replace(/from (['"])(\.[^'"]+)\1/g,(_match,quote,relative)=>`from ${quote}${resolve(dirname(join(root,path)),relative)}${quote}`);
 const file=join(folder,'owner.ts');await Bun.write(file,source);
 return {path:file,module:await import(file),cleanup:()=>rm(folder,{recursive:true,force:true}),sourceSha256:Bun.SHA256.hash(source,'hex')};
}
