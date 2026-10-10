import {expect,test} from 'bun:test';
import {readerLoad,createReader} from '../src/lib/reading/reader/engine';

test('closing a reader cancels decoder waits even when the decoder never settles',async()=>{
 const controller=new AbortController();
 const opened=readerLoad(new Promise<never>(()=>{}),controller.signal);
 controller.abort();
 await expect(opened).rejects.toMatchObject({name:'AbortError'});
});

test('already-closed readers reject before importing a format or touching the host',async()=>{
 const controller=new AbortController();controller.abort();
 await expect(createReader({signal:controller.signal,format:'pdf',host:null!,source:'unused',location:null,changed:()=>{throw new Error('A closed reader rendered.');}})).rejects.toMatchObject({name:'AbortError'});
 await expect(readerLoad(Promise.reject(new Error('Decoder failed')),controller.signal)).rejects.toMatchObject({name:'AbortError'});
});

test('decoder errors remain visible and normal loads remove their cancellation listener',async()=>{
 const controller=new AbortController();
 expect(await readerLoad(Promise.resolve('opened'),controller.signal)).toBe('opened');
 await expect(readerLoad(Promise.reject(new Error('Invalid file')),controller.signal)).rejects.toThrow('Invalid file');
 controller.abort();
});
