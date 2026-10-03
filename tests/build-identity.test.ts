import {expect,test} from 'bun:test';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {serverBuildIdentity} from '../src/lib/server/build-identity';

test('build identity changes with executable chunks while maps and browser assets do not alter it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coast-build-identity-'));
 try{
  await mkdir(join(root,'server/chunks'),{recursive:true});await mkdir(join(root,'client'),{recursive:true});
  await Bun.write(join(root,'index.js'),'import "./server/index.js";');
  await Bun.write(join(root,'handler.js'),'export const serveAssets=true;');
  await Bun.write(join(root,'env.js'),'export const prefix="";');
  await Bun.write(join(root,'server/index.js'),'import "./chunks/query.js";');
  await Bun.write(join(root,'server/chunks/query.js'),'export const result=1;');
  const before=await serverBuildIdentity(root);expect(before).toMatch(/^sha256:/);
  await Bun.write(join(root,'client/app.js'),'browser assets');await Bun.write(join(root,'server/chunks/query.js.map'),'debug map');
  expect(await serverBuildIdentity(root)).toBe(before);
  await Bun.write(join(root,'server/chunks/query.js'),'export const result=2;');
  const changed=await serverBuildIdentity(root);expect(changed).not.toBe(before);
  expect(await serverBuildIdentity(root)).toBe(changed);
  await Bun.write(join(root,'index.js'),'changed bootstrap');expect(await serverBuildIdentity(root)).not.toBe(changed);
  const bootstrap=await serverBuildIdentity(root);
  await Bun.write(join(root,'handler.js'),'export const serveAssets=false;');
  const handler=await serverBuildIdentity(root);expect(handler).not.toBe(bootstrap);
  await Bun.write(join(root,'env.js'),'export const prefix="COAST_";');
  expect(await serverBuildIdentity(root)).not.toBe(handler);
 }finally{await rm(root,{recursive:true,force:true});}
});
