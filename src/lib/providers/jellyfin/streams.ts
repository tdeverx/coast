import * as v from 'valibot';
const text=v.nullish(v.string());
const number=v.nullish(v.number());
// Whitelist display fields. Tokens, IP addresses and media source paths never leave the adapter.
export const activeSessionsSchema=v.array(v.object({
  Id:v.string(),UserId:text,UserName:text,Client:text,DeviceName:text,
  NowPlayingItem:v.nullish(v.object({Id:v.string(),Name:text,SeriesName:text,Type:text,ParentIndexNumber:number,IndexNumber:number,RunTimeTicks:number})),
  PlayState:v.nullish(v.object({IsPaused:v.optional(v.boolean(),false),PositionTicks:number,PlayMethod:text})),
}));
export function streamPresentation(session:v.InferOutput<typeof activeSessionsSchema>[number]){
  const item=session.NowPlayingItem;
  if(!item)return null;
  const code=item.Type==='Episode'&&item.ParentIndexNumber!=null&&item.IndexNumber!=null?`S${String(item.ParentIndexNumber).padStart(2,'0')}E${String(item.IndexNumber).padStart(2,'0')}`:null;
  const duration=Math.max(0,item.RunTimeTicks??0)/10_000_000;
  const position=Math.max(0,session.PlayState?.PositionTicks??0)/10_000_000;
  return {id:session.Id,externalId:item.Id,externalUserId:session.UserId??null,mediaType:item.Type??null,username:session.UserName??'Unknown user',title:item.SeriesName??item.Name??'Untitled',episode:code,client:session.Client??null,device:session.DeviceName??null,paused:session.PlayState?.IsPaused??false,method:session.PlayState?.PlayMethod??null,duration,position,progress:duration>0?Math.min(1,position/duration):null};
}
