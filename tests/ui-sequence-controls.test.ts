import { expect, test } from 'bun:test';
import { compileModule } from 'svelte/compiler';
import type { api, change } from '../src/lib/ui/client';
import type { MediaView } from '../src/lib/ui/types';
const moduleUrl = (source: string) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const clientUrl = moduleUrl('export const message = error => error.message; export const refreshAfterChange = async () => {};');
const playbackUrl = moduleUrl('export const plays=[]; export const playMedia=async (...args)=>plays.push(args); export const playMusicQueue=async ()=>{};');
const source = await Bun.file(new URL('../src/lib/ui/controls/sequence.svelte.ts', import.meta.url)).text();
const compiled = compileModule(new Bun.Transpiler({loader:'ts'}).transformSync(source), {filename:'sequence.svelte.js', generate:'client'}).js.code
  .replaceAll('svelte/internal/client', import.meta.resolve('svelte/internal/client'))
  .replaceAll('$lib/ui/client', clientUrl)
  .replaceAll('$lib/playback/client.svelte', playbackUrl)
  .replaceAll('$lib/media/sequence', import.meta.resolve('../src/lib/media/sequence'));
const {createSequencePlayback}: typeof import('../src/lib/ui/controls/sequence.svelte') = await import(moduleUrl(compiled));
const playback = await import(playbackUrl);

test('an unavailable sequence member requires an explicit skip before playing the next item', async () => {
  const paths: string[]=[];
  const blocked = {id:'episode-one', title:'Episode one', available:false, sequence:{kind:'playlist',id:'playlist',entryId:'entry-one'}} as MediaView;
  const playable = {...blocked, id:'episode-two', available:true, sequence:{...blocked.sequence!,entryId:'entry-two'}};
  playback.plays.length=0;
  const sequence=createSequencePlayback({source:()=>({kind:'playlist',id:'playlist'}), experimentalMusic:()=>false, preview:false,
    api: (async (path: string) => {paths.push(path);return {next:paths.length===1?blocked:playable};}) as typeof api,
    change: (async()=>{}) as typeof change});
  await sequence.start();
  expect(sequence.open).toBe(true);
  expect(playback.plays).toHaveLength(0);
  expect(paths).toHaveLength(1);
  await sequence.actions.find(action=>action.text==='Skip this item')!.onclick!();
  expect(paths[1]).toContain('after=entry-one');
  expect(playback.plays[0][0]).toBe('episode-two');
  expect(sequence.open).toBe(false);
});

test('sequence playback ignores preview controls and suppresses duplicate starts while loading', async () => {
  let calls=0, complete!: (value:{next:null})=>void;
  const options={source:()=>({kind:'playlist' as const,id:'playlist'}), experimentalMusic:()=>false,
    api: (()=>{calls++;return new Promise<{next:null}>(resolve=>{complete=resolve;});}) as typeof api,
    change: (async()=>{}) as typeof change};
  await createSequencePlayback({...options,preview:true}).start();
  expect(calls).toBe(0);
  const sequence=createSequencePlayback({...options,preview:false});
  const first=sequence.start();
  await Promise.resolve();
  await sequence.start();
  expect(calls).toBe(1);
  complete({next:null});await first;
  expect(sequence.busy).toBe(false);
  expect(sequence.title).toBe('Sequence complete');
});
