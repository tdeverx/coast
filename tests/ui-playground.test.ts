import {expect,test} from 'bun:test';
import {contracts,defaultSlot,emptyCustomisation,handlerMode,parseData,specimenDefaults} from '../src/routes/ui-preview/props';
import {previewProps} from '../scripts/ui-props';

test('each reusable component has a source-matched contract and independent synthetic input',()=>{
 for(const [name,contract] of Object.entries(contracts)) {
  expect(contract.props).toEqual(previewProps(contract.path));
  const first=specimenDefaults(name),second=specimenDefaults(name);
  expect(first).toEqual(second);
  if(first.item) {(first.item as {title:string}).title='Changed';expect((second.item as {title:string}).title).not.toBe('Changed');}
  expect(new Set(contract.props.map(prop=>prop.name)).size).toBe(contract.props.length);
 }
});
test('contracts retain nullable values, full enum choices, bindings, callbacks and snippet roles',()=>{
 const prop=(name:string,key:string)=>contracts[name].props.find(prop=>prop.name===key)!;
 expect(prop('Icon','name').choices).toContain('collection');
 expect(prop('MediaCard','shape').choices).toEqual(['poster','square','circle','fanart','banner']);
 expect(prop('Button','menu').kind).toBe('boolean');
 expect(prop('Button','href').kind).toBe('text');
 expect(prop('Button','material').choices).toEqual(['clear','glassLight','glassDark','glassProminent']);
 expect(prop('Dialog','open').bindable).toBe(true);
 expect(prop('Heading','heading').kind).toBe('snippet');
 expect(prop('Pagination','onchange').kind).toBe('callback');
 expect(prop('OperationProgress','total')).toMatchObject({kind:'number',nullable:true});
 expect(defaultSlot('IdentityCard',prop('IdentityCard','title')).kind).toBe('text');
 expect(defaultSlot('Field',prop('Field','children')).kind).toBe('field');
 expect(handlerMode('Button',prop('Button','onclick'),emptyCustomisation())).toBe('example');
 expect(handlerMode('Pagination',prop('Pagination','pageUrl'),emptyCustomisation())).toBe('off');
});
test('structured prop editing rejects invalid JSON and the wrong container without replacing the fixture',()=>{
 const items=contracts.FactList.props.find(prop=>prop.name==='items')!;
 expect(()=>parseData('{',items)).toThrow();
 expect(()=>parseData('{}',items)).toThrow('array');
 expect(()=>parseData('null',items)).toThrow('null');
 expect(parseData('[{"label":"Count","value":"0"}]',items)).toEqual([{label:'Count',value:'0'}]);
 expect((specimenDefaults('FactList').items as unknown[]).length).toBeGreaterThan(1);
});
