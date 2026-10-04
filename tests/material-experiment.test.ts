import { expect, test } from 'bun:test';
import { experimentalDefaults, effectGroups, readExperimentalEffects } from '../src/lib/ui/materials/experimental';

test('temporary effects all start disabled and expose every control', () => {
  const controls: string[] = effectGroups.flatMap(group => [group.color, group.blend, ...group.controls.map(control => control.key)]);
  expect(controls.sort()).toEqual(Object.keys(experimentalDefaults).sort());
  expect(Object.entries(experimentalDefaults).filter(([key]) => key.endsWith('Amount')).every(([, value]) => value === 0)).toBe(true);
  const draft = readExperimentalEffects({ sheenAmount: 999, edgeWidth: -10, frostAmount: 90, frostBlur: Infinity, interactionAmount: 40, sheenColor: '#abcdef', sheenBlend: 'screen', edgeBlend: 'wrong', unknown: 5 });
  expect(draft.sheenAmount).toBe(100);
  expect(draft.edgeWidth).toBe(.25);
  expect('frostBlur' in draft).toBe(false);
  expect('frostAmount' in draft).toBe(false);
  expect(draft.sheenColor).toBe('#abcdef');
  expect(draft.sheenBlend).toBe('screen');
  expect(draft.edgeBlend).toBe('normal');
  expect(draft.interactionAmount).toBe(40);
  expect('unknown' in draft).toBe(false);
  expect(experimentalDefaults.interactionAmount).toBe(0);
  expect(readExperimentalEffects(null)).toEqual(experimentalDefaults);
});

test('interaction sheen coalesces layout reads and cancels pending work on leave/update/disposal', async () => {
  const { experimentalMaterial } = await import('../src/lib/ui/materials/experimental');
  const previous = { matchMedia: globalThis.matchMedia, document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
  const frames = new Map<number,FrameRequestCallback>();
  const listeners = new Map<string,EventListener>();
  let sequence = 0, reads = 0;
  const style = () => ({setProperty() {}});
  const node = {addEventListener:(name:string,fn:EventListener)=>listeners.set(name,fn),
    removeEventListener:(name:string)=>listeners.delete(name),append() {},contains:()=>false,
    getBoundingClientRect:()=>{reads++;return {left:0,top:0,width:100,height:100};}};
  const mediaListeners = new Set<EventListener>();
  const preference = {matches:false,addEventListener:(_name:string,fn:EventListener)=>mediaListeners.add(fn),
    removeEventListener:(_name:string,fn:EventListener)=>mediaListeners.delete(fn)};
  let action:ReturnType<typeof experimentalMaterial>|undefined;
  try {
    globalThis.matchMedia = (()=>preference) as unknown as typeof matchMedia;
    globalThis.document = {createElement:()=>({style:style(),dataset:{},setAttribute() {},remove() {}})} as unknown as Document;
    globalThis.requestAnimationFrame = callback=>{frames.set(++sequence,callback);return sequence;};
    globalThis.cancelAnimationFrame = id=>{frames.delete(id);};
    const effects = {...experimentalDefaults,interactionAmount:20};
    action = experimentalMaterial(node as unknown as HTMLElement,{enabled:true,effects});
    const move = ()=>listeners.get('pointermove')!({clientX:25,clientY:30,pointerType:'mouse'} as unknown as Event);
    move();move();move();
    expect(reads).toBe(0);expect(frames.size).toBe(1);
    const [id,callback]=[...frames][0];frames.delete(id);callback(0);
    expect(reads).toBe(1);
    move();listeners.get('pointerleave')!({} as Event);expect(frames.size).toBe(0);
    move();action.update({enabled:false,effects});expect(frames.size).toBe(0);
    move();expect(frames.size).toBe(0);
    action.update({enabled:true,effects});move();action.destroy();action=undefined;
    expect(frames.size).toBe(0);expect(listeners.size).toBe(0);expect(mediaListeners.size).toBe(0);
  } finally {
    action?.destroy();Object.assign(globalThis,previous);
  }
});
