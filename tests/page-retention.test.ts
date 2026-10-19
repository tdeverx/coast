import {expect,test} from 'bun:test';
import {createPageRetention,validPageInterval,pageInterval} from '../src/lib/page-window';

// Ownership/boundary controls, not fabricated catalogue or browser performance evidence.
test('independent action leases block eviction until every owner releases, with idempotent cleanup',()=>{
  let releases=0;
  const retention=createPageRetention(()=>releases++);
  const menu=retention.retain('owner'),write=retention.retain('owner');
  expect(retention.canRelease(['owner'],[])).toBe(false);
  expect(retention.canRelease(['owner'],['owner'])).toBe(true);
  menu();menu();expect(releases).toBe(1);
  expect(retention.canRelease(['owner'],[])).toBe(false);
  write();expect(releases).toBe(2);
  expect(retention.canRelease(['owner'],[])).toBe(true);
  const next=retention.retain('owner');menu();
  expect(retention.canRelease(['owner'],[])).toBe(false);next();
});

test('page intervals clamp both ends and never admit a reversed, fractional or oversized neighborhood',()=>{
  expect(pageInterval(8,12,10)).toEqual({firstPage:8,lastPage:8});
  expect(pageInterval(8,8,6)).toEqual({firstPage:6,lastPage:8});
  for(const[first,last]of [[0,1],[3,1],[1,4],[1,1.5],[1_000_000,1_000_001]])
    expect(validPageInterval(first,last)).toBe(false);
  expect(validPageInterval(1,3)).toBe(true);
});

test('scope retirement detaches old owners without releasing or notifying a replacement scope',()=>{
  let releases=0;
  const retention=createPageRetention(()=>releases++),old=retention.retain('owner');
  retention.retire();expect(retention.canRelease(['owner'],[])).toBe(true);
  const current=retention.retain('owner');old();
  expect(releases).toBe(0);expect(retention.canRelease(['owner'],[])).toBe(false);
  current();expect(releases).toBe(1);expect(retention.canRelease(['owner'],[])).toBe(true);
});
