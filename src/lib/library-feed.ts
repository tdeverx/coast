import * as v from 'valibot';
import type {ShelfItem} from './ui/shelves/types';
import type {MediaView} from './ui/types';

export const recentLibrarySchema=v.object({
  action:v.optional(v.picklist(['watch','listen','play','read'])),
  kind:v.optional(v.picklist(['all','movie','show','music','game','book','comic']),'movie'),
  page:v.optional(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(1_000_000)),1),
  preview:v.optional(v.boolean(),false),
});
export const requestStates=[
  {value:'all',label:'All'}, {value:'available',label:'Available'}, {value:'processing',label:'In progress'},
  {value:'approved',label:'Accepted'}, {value:'pending',label:'Pending'}, {value:'declined',label:'Declined'},
  {value:'cancelled',label:'Cancelled'}, {value:'failed',label:'Failed'},
] as const;
export const requestSegments=requestStates
  .filter(state=>!['all','cancelled','failed'].includes(state.value))
  .map(state=>state.value==='processing'?{...state,label:'Processing'}:state);
export const requestFeedSchema=v.object({
  state:v.optional(v.picklist(['available','pending','approved','processing','declined']),'available'),
  kind:v.optional(v.picklist(['all','movie','show']),'all'),
  page:v.optional(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(1_000_000)),1),
  preview:v.optional(v.boolean(),false),
});
export type LibraryFeedContent={items:ShelfItem[];page:number;pages:number;total:number;availableStates?:string[]};
export const requestStatusLabel=(state:string)=>requestStates.find(option=>option.value===state)?.label??'Unknown';
export function requestFeedCard(item:MediaView,request:{id:string;state:string;destination:string;createdAt:Date|string},actor?:{username:string;avatar?:string|null}):MediaView{
  const label=requestStatusLabel(request.state);
  return {...item,entryId:request.id,captionActor:actor,
    captionSubtitle:`Requested · ${request.destination}`,captionDate:actor?new Date(request.createdAt).toISOString():undefined,
    captionStatus:{label,
      icon:['available','approved'].includes(request.state)?'check':['pending','processing'].includes(request.state)?'clock':'close',
      tone:request.state==='available'?'positive':['pending','approved','processing'].includes(request.state)?'pending':'negative'},
  };
}
