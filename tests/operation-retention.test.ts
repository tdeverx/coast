import {expect,test} from 'bun:test';
import {compileRunes,moduleUrl} from './fixtures/ui-script';
const source=(await Bun.file(new URL('../src/lib/ui/operation.svelte.ts',import.meta.url)).text())
  .replace("import { message } from './client';",'const message=cause=>cause.message;');
const {createOperation}=await import(moduleUrl(compileRunes(source)));

test('an acknowledged or failed operation retains its owner through completion and rejects duplicate admission',async()=>{
  for(const fail of [false,true]) {
    let held=0,released=0,finish!:()=>void;
    const operation=createOperation(()=>{held++;return()=>{held--;released++;};});
    const pending=operation.run(async()=>{await new Promise<void>(resolve=>finish=resolve);if(fail)throw Error('Required failure control');});
    expect(held).toBe(1);expect(await operation.run(async()=>{})).toBe(false);
    expect(held).toBe(1);expect(released).toBe(0);
    finish();expect(await pending).toBe(!fail);
    expect(held).toBe(0);expect(released).toBe(1);expect(operation.busy).toBe(false);
    expect(operation.error).toBe(fail?'Required failure control':'');
  }
});
