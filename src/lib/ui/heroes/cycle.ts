export type HeroPhase='artwork'|'trailer'|'after'|'complete';
type Clock={now:()=>number;set:(callback:()=>void,delay:number)=>unknown;clear:(timer:unknown)=>void};
const browserClock:Clock={now:()=>performance.now(),set:(fn,delay)=>setTimeout(fn,delay),clear:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>)};

/** One visible hero owns one pausable deadline; a trailer ends through media events. */
export function createHeroCycle(options:{trailer:()=>boolean;phase:(phase:HeroPhase)=>void;next:()=>void},clock:Clock=browserClock){
  let phase:HeroPhase='artwork',remaining=5000,started=0,timer:unknown,running=false,disposed=false;
  function cancel(){if(timer!==undefined){clock.clear(timer);timer=undefined;}}
  function schedule(){
    cancel();
    if(!running||disposed||!Number.isFinite(remaining))return;
    started=clock.now();
    timer=clock.set(()=>{timer=undefined;remaining=0;expire();},remaining);
  }
  function enter(next:HeroPhase,delay:number){phase=next;remaining=delay;options.phase(phase);schedule();}
  function expire(){
    if(disposed)return;
    if(phase==='artwork'){
      if(options.trailer())enter('trailer',30000); // Bound a failed media startup, never the trailer's duration.
      else enter('after',5000);
    }else if(phase==='trailer')finishTrailer();
    else if(phase==='after'){enter('complete',Infinity);options.next();}
  }
  function finishTrailer(){if(!disposed&&phase==='trailer')enter('after',5000);}
  return {
    get phase(){return phase;},
    running(value:boolean){
      if(disposed||running===value)return;
      if(running&&timer!==undefined)remaining=Math.max(0,remaining-(clock.now()-started));
      running=value;schedule();
    },
    restart(){if(!disposed)enter('artwork',5000);},
    playing(){if(phase==='trailer'){remaining=Infinity;cancel();}},
    finishTrailer,
    dispose(){disposed=true;cancel();},
  };
}
