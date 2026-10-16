import {expect,test} from 'bun:test';
import {shelfControls} from '../src/lib/ui/shelves/controls';
import type {ShelfControl} from '../src/lib/ui/shelves/types';

test('every shelf source partitions segments from secondary choices without invoking a load',()=>{
 let changes=0;
 const controls:ShelfControl[]=[
  {type:'availability',label:'Availability',value:'all',change:()=>changes++},
  {type:'segments',label:'Medium',value:'watch',options:[{value:'watch',label:'Watch'}],change:()=>changes++},
  {type:'collection',label:'Collection',value:'all',change:()=>changes++},
  {type:'media-type',label:'Type',value:'all',mediums:{experimentalMusic:false,experimentalGaming:false,experimentalBooks:true,experimentalComics:true},change:()=>changes++},
 ];
 const result=shelfControls(controls,(control,value)=>control.change(value));
 expect(result.segments.map(control=>control.label)).toEqual(['Medium']);
 expect(result.groups.map(group=>group.label)).toEqual(['Availability','Collection','Type']);
 expect(result.groups[0].options.map(option=>option.value)).toEqual(['all','available']);
 expect(result.groups[1].options.map(option=>option.value)).toEqual(['all','collection']);
 expect(result.groups[2].options.map(option=>option.value)).toContain('book');
 expect(result.groups[2].options.map(option=>option.value)).toContain('comic');
 expect(changes).toBe(0);
 result.groups[0].change('available');expect(changes).toBe(1);
 expect(controls.map(control=>control.type)).toEqual(['availability','segments','collection','media-type']);
});

test('secondary menu choices retain source-specific values and dispatch only their owning command',()=>{
 const calls:string[]=[];
 const control:ShelfControl={type:'select',label:'Role',value:'director',options:[{value:'director',label:'Director'},{value:'actor',label:'Actor'}],change:value=>calls.push(value)};
 const result=shelfControls([control],(selected,value)=>{expect(selected).toBe(control);selected.change(value);});
 expect(result.segments).toHaveLength(0);
 expect(result.groups[0].value).toBe('director');
 expect(result.groups[0].options).toBe(control.options!);
 result.groups[0].change('actor');expect(calls).toEqual(['actor']);
});
