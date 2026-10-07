import * as v from 'valibot';
import {activeSessionsSchema} from './streams';

const sequence=v.pipe(v.number(),v.integer(),v.minValue(0),v.maxValue(Number.MAX_SAFE_INTEGER));
const id=v.pipe(v.string(),v.regex(/^[a-f0-9]{32}$/i),v.toLowerCase());
export const companionPageSchema=v.object({
  protocol:v.literal(1),serverId:v.string(),epoch:id,cursor:sequence,reset:v.boolean(),more:v.boolean(),
  changes:v.pipe(v.array(v.object({Sequence:sequence,Kind:v.picklist(['item-updated','item-removed','user-data','user-updated']),
    ItemId:v.nullable(id),UserId:v.nullable(id),ItemType:v.nullable(v.string())})),v.maxLength(200)),
  sessions:activeSessionsSchema,
});
export type CompanionPage=v.InferOutput<typeof companionPageSchema>;
export type CompanionState={connectionId:string;generation:string;epoch?:string;cursor?:number;checkedAt:string;status:'healthy'|'reconciling'|'unavailable';reason?:string};
/** Reject malformed cursors before any acknowledgement or personal write. */
export function validateCompanionPage(page:CompanionPage,previous:Pick<CompanionState,'epoch'|'cursor'>,serverId:string){
  if(page.serverId!==serverId)throw new Error('The companion returned a different Jellyfin server.');
  if(page.reset){if(page.more||page.changes.length)throw new Error('Invalid companion reset.');return;}
  if(page.epoch!==previous.epoch||page.cursor<(previous.cursor??0))throw new Error('Invalid companion cursor.');
  let cursor=previous.cursor??0;
  for(const change of page.changes){if(change.Sequence<=cursor||change.Sequence>page.cursor)throw new Error('Companion changes are out of order.');cursor=change.Sequence;}
  if(cursor!==page.cursor||(page.more&&!page.changes.length))throw new Error('Incomplete companion page.');
}
export function companionHealthy(saved:unknown,now:number,intervalMinutes:number){
  const state=saved as Partial<CompanionState>|undefined;
  const checked=Date.parse(state?.checkedAt??'');
  return state?.status==='healthy'&&Number.isFinite(checked)&&checked<=now&&now-checked<=Math.max(3,intervalMinutes*3)*60000;
}
const videoTypes=new Set(['Movie','Series','Season','Episode']);
const musicTypes=new Set(['Audio','MusicAlbum']);
/** Coalesce the batch by final item state; a later re-add supersedes a removal. */
export function companionPlan(page:CompanionPage){
  const items=new Map<string,CompanionPage['changes'][number]>();
  const personal=new Map<string,{video:Set<string>;music:Set<string>;permissions:boolean}>();
  for(const change of page.changes){
    if(change.Kind==='item-updated'||change.Kind==='item-removed'){if(change.ItemId)items.set(change.ItemId,change);continue;}
    if(!change.UserId)continue;
    const account=personal.get(change.UserId)??{video:new Set<string>(),music:new Set<string>(),permissions:false};
    if(change.Kind==='user-updated')account.permissions=true;
    else if(change.ItemId){if(videoTypes.has(change.ItemType??''))account.video.add(change.ItemId);else if(musicTypes.has(change.ItemType??''))account.music.add(change.ItemId);}
    personal.set(change.UserId,account);
  }
  return {items:[...items.values()],personal,video:[...items.values()].filter(c=>c.Kind==='item-updated'&&videoTypes.has(c.ItemType??'')).map(c=>c.ItemId!),music:[...items.values()].filter(c=>c.Kind==='item-updated'&&musicTypes.has(c.ItemType??'')).map(c=>c.ItemId!),removed:[...items.values()].filter(c=>c.Kind==='item-removed').map(c=>c.ItemId!)};
}
