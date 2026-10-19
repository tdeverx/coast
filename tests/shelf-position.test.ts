import {expect,test} from 'bun:test';
import {shelfScrollOwner} from '../src/lib/ui/shelf-position';

test('the declared sheet content owner survives temporary hidden overflow during Back restoration',()=>{
  const previous=globalThis.getComputedStyle;
  const expansion={parentElement:null,hasAttribute:()=>false,overflow:'auto'};
  const content={parentElement:expansion,hasAttribute:(name:string)=>name==='data-shelf-scroll',overflow:'hidden'};
  const card={parentElement:content} as unknown as HTMLElement;
  globalThis.getComputedStyle=((node:any)=>({overflowY:node.overflow})) as typeof getComputedStyle;
  try{
    expect(shelfScrollOwner(card)).toBe(content as unknown as HTMLElement);
    content.overflow='auto';expect(shelfScrollOwner(card)).toBe(content as unknown as HTMLElement);
  }finally{globalThis.getComputedStyle=previous;}
});
