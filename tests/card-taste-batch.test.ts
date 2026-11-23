import { expect, test } from 'bun:test';
import { createCardTasteBatch } from '../src/lib/ui/card-taste-batch';
import { maxTasteBatchSize, type CardTasteResponse } from '../src/lib/social/card-taste';

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

test('visible cards share bounded reads and reuse both percentages and abstentions', async () => {
  const calls: string[][] = [], values: Array<number | undefined> = [];
  const batch = createCardTasteBatch(async ids => {
    calls.push(ids);
    return {scores:Object.fromEntries(ids.filter(id => id !== '1').map(id => [id, 0]))};
  });
  for (let i = 0; i <= maxTasteBatchSize; i++) batch.watch(String(i), () => {});
  const leave = batch.watch('0', score => values.push(score));
  await settle();
  expect(calls.map(ids => ids.length)).toEqual([maxTasteBatchSize, 1]);
  leave();
  batch.watch('0', score => values.push(score));
  batch.watch('1', score => values.push(score));
  await settle();
  expect(calls.length).toBe(2);
  expect(values).toEqual([0, 0, undefined]);
  batch.dispose();
});

test('the last visible consumer can cancel and a withdrawn viewer cannot publish a late score', async () => {
  const requests: {signal:AbortSignal; resolve:(response:CardTasteResponse)=>void}[] = [];
  const batch = createCardTasteBatch((_ids, signal) => new Promise(resolve => requests.push({signal, resolve})));
  const values: Array<number | undefined> = [];
  const first = batch.watch('a', score => values.push(score));
  const second = batch.watch('b', score => values.push(score));
  await settle();
  first();
  await settle();
  expect(requests[0].signal.aborted).toBe(false);
  second();
  await settle();
  expect(requests[0].signal.aborted).toBe(true);
  batch.watch('a', score => values.push(score));
  await settle();
  batch.dispose();
  for (const request of requests) request.resolve({scores:{a:95,b:74}});
  await settle();
  expect(requests).toHaveLength(2);
  expect(requests[1].signal.aborted).toBe(true);
  expect(values).toEqual([]);
});

test('a published score survives remounts and stays visible until a newer profile answers', async () => {
  const reads: {ids:string[]; finish:(value:CardTasteResponse)=>void}[]=[];
  const batch=createCardTasteBatch(ids=>new Promise(finish=>reads.push({ids,finish})));
  const seen:(number|undefined)[]=[];
  batch.refresh('first');
  const leave=batch.watch('movie',score=>seen.push(score));
  await settle();
  reads[0].finish({scores:{movie:81}});
  await settle();
  leave();
  expect(batch.peek('movie')).toBe(81);
  batch.watch('movie',score=>seen.push(score));
  batch.refresh('first');
  await settle();
  expect(reads).toHaveLength(1);
  batch.refresh('second');
  await settle();
  expect(reads[1].ids).toEqual(['movie']);
  expect(batch.peek('movie')).toBe(81);
  expect(seen).toEqual([81,81]);
  reads[1].finish({scores:{}});
  await settle();
  expect(seen).toEqual([81,81,undefined]);
  expect(batch.peek('movie')).toBeUndefined();
  batch.dispose();
});

test('a pending independent prediction is retried and published when the card returns', async()=>{
  let calls=0;
  const batch=createCardTasteBatch(async():Promise<CardTasteResponse>=>++calls===1?{scores:{},pending:['known']}:{scores:{known:84}});
  const seen:(number|undefined)[]=[];
  const leave=batch.watch('known',value=>seen.push(value));
  await settle();
  leave();
  batch.watch('known',value=>seen.push(value));
  await settle();
  expect(seen).toEqual([undefined,84]);
  expect(batch.peek('known')).toBe(84);
  batch.dispose();
});
