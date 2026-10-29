import {maximumSharedViewers,minimumSharedBitrate} from './policy';
import {vrchatMaximumBitrate,type ShareTarget} from './vrchat-profile';

type Viewer = {id:string;target:ShareTarget;desired_bitrate:number|null};
/** Website streams keep their admitted budget; only VRChat encoders change generations. */
export function allocateViewers(budget:number,active:Viewer[],requested:Viewer,personal:number) {
  const usable=Math.floor(budget*0.85),rates=new Map<string,number>();
  const candidates=active.slice(0,maximumSharedViewers);
  if(!candidates.some(v=>v.id===requested.id)&&candidates.length<maximumSharedViewers)candidates.push(requested);
  let reserved=0;
  const vrchat:Viewer[]=[],pending:Viewer[]=[];
  for(const viewer of candidates){
    if(viewer.target==='vrchat'){vrchat.push(viewer);continue;}
    if(!viewer.desired_bitrate){pending.push(viewer);continue;}
    if(reserved+viewer.desired_bitrate+vrchat.length*minimumSharedBitrate<=usable){rates.set(viewer.id,viewer.desired_bitrate);reserved+=viewer.desired_bitrate;}
  }
  for(const viewer of pending){
    const rate=Math.floor(Math.min(personal,(usable-reserved)/(vrchat.length+1))/50_000)*50_000;
    if(rate>=minimumSharedBitrate){rates.set(viewer.id,rate);reserved+=rate;}
  }
  const capacity=Math.min(vrchat.length,Math.floor((usable-reserved)/minimumSharedBitrate));
  const rate=capacity?Math.min(personal,vrchatMaximumBitrate,Math.floor((usable-reserved)/capacity/50_000)*50_000):0;
  for(const viewer of vrchat.slice(0,capacity))rates.set(viewer.id,rate);
  return rates;
}
