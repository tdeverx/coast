import {expect,test} from 'bun:test';
import {shelfControls} from '../src/lib/ui/shelves/controls';
import type {ShelfControl} from '../src/lib/ui/shelves/types';
import {filterSections} from '../src/lib/ui/controls/filters';

test('every shelf source puts binary and secondary filters in the shared menu without invoking a load',()=>{
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
 expect(result.groups.slice(0, 2).map(group=>group.presentation)).toEqual(['checkbox','checkbox']);
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

test('filter sections preserve every supported choice and coalesce groups without empty dividers',()=>{
 const select=(section:import('../src/lib/ui/controls/filters').FilterSection,label:string):ShelfControl=>({type:'select',section,label,value:'all',options:[{value:'all',label:'All'},{value:'selected',label:'Selected'}],change:()=>{throw new Error('Grouping cannot dispatch changes');}});
 const controls=[select('order','Sort by'),select('content','Media type'),{type:'availability' as const,label:'Available',value:'all',change:()=>{}},select('content','Watch status'),select('access','Sources')];
 const sections=filterSections(shelfControls(controls,(control,value)=>control.change(value)).groups);
 expect(sections.map(groups=>groups.map(group=>group.label))).toEqual([['Media type','Watch status'],['Available','Sources'],['Sort by']]);
 expect(sections.flat().map(group=>group.options.length)).toEqual([2,2,2,2,2]);
 expect(filterSections([])).toEqual([]);
});
