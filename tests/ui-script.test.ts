import {expect,test} from 'bun:test';
// @ts-expect-error Svelte's internal rune test runtime has no public declarations.
import * as runtime from 'svelte/internal/client';
import {compileRunes,moduleUrl} from './fixtures/ui-script';

// A bare read is an effect dependency even when JavaScript would discard it.
const {create}=await import(moduleUrl(compileRunes(`export function create(){
 let revision=$state<number>(0),runs=0;
 $effect(()=>{revision;runs++;});
 return {advance(){revision++;},get runs(){return runs;}};
}`)));
test('rune fixture compilation preserves bare reactive dependencies and disposal',()=>{
 let owner:any;const dispose=runtime.effect_root(()=>owner=create());
 runtime.flush();expect(owner.runs).toBe(1);
 owner.advance();runtime.flush();expect(owner.runs).toBe(2);
 dispose();owner.advance();runtime.flush();expect(owner.runs).toBe(2);
});
