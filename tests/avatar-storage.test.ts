import {expect,test} from 'bun:test';
import {avatarImage} from '../src/lib/core/profile/avatar-storage.server';

test('the actual shipped PNG asset survives avatar header admission byte-for-byte',async()=>{
 const bytes=Buffer.from(await Bun.file(new URL('../src/lib/ui/materials/grain.png',import.meta.url)).arrayBuffer());
 const image=avatarImage('data:image/png;base64,'+bytes.toString('base64'));
 expect(image.format).toBe('png');expect(image.bytes.equals(bytes)).toBe(true);
});

test('a real PNG mislabeled as another raster format is rejected before storage',async()=>{
 const bytes=Buffer.from(await Bun.file(new URL('../src/lib/ui/materials/grain.png',import.meta.url)).arrayBuffer());
 for(const format of ['jpeg','webp'])expect(()=>avatarImage(`data:image/${format};base64,${bytes.toString('base64')}`)).toThrow('not a valid image');
});

test('existing byte and format limits still reject unsupported or oversized input before storage',()=>{
 expect(()=>avatarImage('data:image/svg+xml;base64,PHN2Zz4=')).toThrow('PNG, JPEG, WebP or GIF');
 expect(()=>avatarImage('data:image/png;base64,'+Buffer.alloc(165000).toString('base64'))).toThrow('smaller image');
 expect(()=>avatarImage('data:image/gif;base64,PHN2Zz4=')).toThrow('valid GIF');
});
