import {expect,test} from 'bun:test';
import {createHeroCycle,type HeroPhase} from '../src/lib/ui/heroes/cycle';
function fixture(trailer=true){
  let now=0,serial=0,next=0,starts=0;
  const timers=new Map<number,{at:number;run:()=>void}>(),phases:HeroPhase[]=[];
  const cycle=createHeroCycle({trailer:()=>{starts++;return trailer;},phase:p=>phases.push(p),next:()=>next++},{
    now:()=>now,set:(run,delay)=>{timers.set(++serial,{at:now+delay,run});return serial;},clear:id=>{timers.delete(id as number);},
  });
  return {cycle,phases,timers,get next(){return next;},get starts(){return starts;},tick(ms:number){
    const until=now+ms;
    while(true){const entry=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!entry||entry[1].at>until)break;
      now=entry[1].at;timers.delete(entry[0]);entry[1].run();}
    now=until;
  }};
}
test('artwork lasts five seconds, then the entire trailer, then five seconds before advancing once',()=>{
  const f=fixture();f.cycle.running(true);f.tick(4999);expect(f.starts).toBe(0);
  f.tick(1);expect(f.cycle.phase).toBe('trailer');f.cycle.playing();
  f.tick(180000);expect(f.next).toBe(0);expect(f.timers.size).toBe(0);
  f.cycle.finishTrailer();f.tick(4999);expect(f.next).toBe(0);
  f.tick(1);expect(f.next).toBe(1);f.tick(100000);expect(f.next).toBe(1);
});
test('no trailer shows ten seconds of artwork, including a pause with the remaining deadline preserved',()=>{
  const f=fixture(false);f.cycle.running(true);f.tick(2500);f.cycle.running(false);
  f.tick(60000);expect(f.next).toBe(0);expect(f.starts).toBe(0);
  f.cycle.running(true);f.tick(7499);expect(f.next).toBe(0);
  f.tick(1);expect(f.next).toBe(1);expect(f.phases).toEqual(['after','complete']);
});
test('media failure returns to artwork and startup failure is bounded; neither limits a playing trailer',()=>{
  const failed=fixture();failed.cycle.running(true);failed.tick(5000);failed.cycle.finishTrailer();
  failed.tick(5000);expect(failed.next).toBe(1);
  const stalled=fixture();stalled.cycle.running(true);stalled.tick(34999);expect(stalled.cycle.phase).toBe('trailer');
  stalled.tick(1);expect(stalled.cycle.phase).toBe('after');stalled.tick(5000);expect(stalled.next).toBe(1);
});
test('hidden and manually paused trailers cannot expire their startup deadline; teardown cancels every deadline',()=>{
  const f=fixture();f.cycle.running(true);f.tick(6000);f.cycle.running(false);f.tick(30000);
  expect(f.cycle.phase).toBe('trailer');f.cycle.running(true);f.tick(28999);expect(f.cycle.phase).toBe('trailer');
  f.cycle.dispose();expect(f.timers.size).toBe(0);f.tick(10000);expect(f.next).toBe(0);
  f.cycle.finishTrailer();f.cycle.restart();expect(f.timers.size).toBe(0);
});

test('restarting a completed hero begins with artwork and preserves the full initial delay',()=>{
  const f=fixture(false);f.cycle.running(true);f.tick(10000);expect(f.next).toBe(1);
  f.cycle.restart();expect(f.cycle.phase).toBe('artwork');f.tick(4999);expect(f.starts).toBe(1);
  f.tick(1);expect(f.starts).toBe(2);f.tick(5000);expect(f.next).toBe(2);
});
