import {expect, test} from 'bun:test';
import {createReadinessCheck} from '../src/lib/server/readiness';

test('readiness cancels a stalled probe, coalesces callers and can recover', async () => {
  let calls=0, cancelled=0, healthy=false, release!: () => void;
  const check=createReadinessCheck(() => {
    calls++;
    return Object.assign(healthy?Promise.resolve(1):new Promise<void>(done => {release=done;}), {cancel(){cancelled++;}});
  }, () => false, 20);
  expect(await Promise.all([check(),check(),check()])).toEqual([false,false,false]);
  expect(calls).toBe(1); expect(cancelled).toBe(1);
  expect(await Promise.all([check(),check(),check()])).toEqual([false,false,false]);
  expect(calls).toBe(1);
  healthy=true; release(); await Bun.sleep(0);
  expect(await check()).toBe(true); expect(calls).toBe(2);
});
test('readiness contains failure and cancellation errors without exposing details', async () => {
  const check=createReadinessCheck(() => Object.assign(Promise.reject(Error('private database secret')), {cancel(){}}), () => false);
  expect(await check()).toBe(false);
  const stalled=createReadinessCheck(() => Object.assign(new Promise(() => {}), {cancel(){throw Error('private');}}), () => false, 10);
  expect(await stalled()).toBe(false);
});
test('shutdown refuses readiness and late successful probes cannot report healthy', async () => {
  let stopping=false, calls=0, resolve!: () => void;
  const check=createReadinessCheck(() => {calls++; return Object.assign(new Promise<void>(done => {resolve=done;}), {cancel(){}});}, () => stopping);
  const first=check(); stopping=true; resolve();
  expect(await first).toBe(false); expect(await check()).toBe(false); expect(calls).toBe(1);
});
