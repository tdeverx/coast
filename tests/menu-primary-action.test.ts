import { expect, test } from 'bun:test';
import { compileRunes, componentScript, moduleUrl } from './fixtures/ui-script';

const source = (await componentScript('src/lib/ui/components/Button.svelte'))
  .replaceAll('$props.id()', "'primary-action-test'")
  .replaceAll('$props()', 'properties')
  .replace(/\bexport (?=function)/g, '');
const factory = await import(moduleUrl(compileRunes(`
 const useClient=()=>({preview:false}),getContext=()=>true,untrack=fn=>fn();
 const useMenuPreview=()=>undefined,notifyAction=()=>{};
 export function create(properties,events){
  const createMenuController=()=>({nested:true,open:false,openMenu:focused=>events.push(['open',focused]),closeAll:focused=>events.push(['close',focused])});
  ${source}
  return {activate};
 }
`)));

test('the primary row activates on click and Enter while its disclosure only opens the submenu', () => {
  const previous = globalThis.Element;
  class Target { constructor(private disclosure = false) {} closest() { return this.disclosure ? this : null; } }
  globalThis.Element = Target as unknown as typeof Element;
  const events: unknown[] = [];
  try {
    const button = factory.create({menu:true,primaryAction:()=>events.push('primary')},events);
    button.activate({target:new Target(),detail:1});
    expect(events.splice(0)).toEqual(['primary',['close',true]]);
    button.activate({target:new Target(),detail:0});
    expect(events.splice(0)).toEqual(['primary',['close',true]]);
    button.activate({target:new Target(true),detail:1});
    expect(events.splice(0)).toEqual([['open',false]]);
    const disabled=factory.create({menu:true,disabled:true,primaryAction:()=>events.push('primary')},events);
    disabled.activate({target:new Target(),detail:1,preventDefault(){events.push('prevent');}});
    expect(events).toEqual(['prevent']);
  } finally { globalThis.Element = previous; }
});
