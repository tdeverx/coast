import { expect, test } from 'bun:test';
import { decideSync } from '../src/lib/sync/values.server';

test('sync distinguishes remote edits, local edits, and simultaneous conflicts', () => {
  const baseline = { remote: { value: 2 }, agreed: { value: 2 }, conflict: false };
  expect(decideSync({ value: 2 }, { value: 3 }, baseline)).toBe('remote');
  expect(decideSync({ value: 4 }, { value: 2 }, baseline)).toBe('local');
  expect(decideSync({ value: 4 }, { value: 3 }, baseline)).toBe('conflict');
  expect(decideSync({ value: 4 }, { value: 4 }, baseline)).toBe('agree');
  expect(decideSync({ value: null }, { value: 3 })).toBe('remote');
  expect(decideSync({ value: 4 }, { value: 3 })).toBe('conflict');
});
test('converged values clear an obsolete conflict without selecting a winner', () => {
  expect(
    decideSync(
      { value: true },
      { value: true },
      { remote: { value: false }, agreed: { value: false }, conflict: true }
    )
  ).toBe('agree');
});
test('empty destinations and provider resume precision do not invent conflicts',()=>{
 expect(decideSync({value:true},{value:false})).toBe('local');
 expect(decideSync({positionSeconds:0,durationSeconds:3250.706},{positionSeconds:0,durationSeconds:3251})).toBe('agree');
 expect(decideSync({positionSeconds:2037.125,durationSeconds:3251},{positionSeconds:2037,durationSeconds:3249})).toBe('agree');
 expect(decideSync({positionSeconds:2037,durationSeconds:3251},{positionSeconds:2200,durationSeconds:3251})).toBe('conflict');
 expect(decideSync({positionSeconds:0,durationSeconds:1},{positionSeconds:0.3,durationSeconds:1})).toBe('remote');
});
