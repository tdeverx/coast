/** Credit real elapsed playback only; position jumps are never played time. */
export function actualPlayedDelta(previous:number,current:number,elapsedSeconds:number,playing:boolean,seeking=false){
  if(!playing||seeking||![previous,current,elapsedSeconds].every(Number.isFinite)||elapsedSeconds<=0)return 0;
  const delta=current-previous;
  return delta>0 && delta<=elapsedSeconds+0.75?Math.min(delta,elapsedSeconds):0;
}
export function listenReached(played:number,duration:number,threshold:number){return duration>0 && Number.isFinite(played) && played/duration>=Math.min(100,Math.max(1,Math.trunc(threshold)))/100;}
// Media timestamps and server report arrivals are sampled on different clocks.
// Bound reports by elapsed time with a quarter-second sampling allowance.
export function acceptedPlayedTime(previous:number,reported:number,elapsed:number,active:boolean){return previous+(active?Math.min(Math.max(0,reported-previous),Math.max(0,elapsed)+0.25):0);}
