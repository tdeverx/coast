import {expect,test} from 'bun:test';
import {createReader} from '../src/lib/reading/reader/engine';
import {readerLoad} from '../src/lib/reading/reader/load';
import {readingFormat,readingLocationSchema} from '../src/lib/reading/model';
import * as v from 'valibot';
import {bookFormat} from '../src/lib/providers/jellyfin/reading.server';

test('ZIP comics share the CBZ decoder contract for local and Jellyfin sources',()=>{
 expect(readingFormat('Comic.ZIP')).toBe('cbz');
 expect(readingFormat('Comic.cbz')).toBe('cbz');
 expect(bookFormat({Id:'0'.repeat(32),Type:'Book',Path:'/books/Comic.zip',ProviderIds:{}})).toBe('cbz');
 expect(bookFormat({Id:'0'.repeat(32),Type:'Book',Container:'zip',ProviderIds:{}})).toBe('cbz');
 expect(readingFormat('Comic.cbz.exe')).toBeNull();
 expect(readingFormat('Book.mobi')).toBeNull();
});

test('Jellyfin comic formats normalize aliases and retain distinct page contracts',()=>{
 for(const [format,alias] of [['cbr','rar'],['cb7','7z'],['cbt','cbt']] as const){
  expect(readingFormat(`Comic.${alias.toUpperCase()}`)).toBe(format);
  expect(readingFormat(`Comic.${format}`)).toBe(format);
  expect(bookFormat({Id:'0'.repeat(32),Type:'Book',Container:alias,ProviderIds:{}})).toBe(format);
  expect(v.parse(readingLocationSchema,{format,page:2,total:3})).toEqual({format,page:2,total:3});
  expect(v.safeParse(readingLocationSchema,{format,page:0,total:3}).success).toBe(false);
 }
 expect(readingFormat('Comic.tar')).toBeNull();
 expect(readingFormat('Comic.cba')).toBeNull();
});

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
