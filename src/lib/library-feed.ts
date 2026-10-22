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
  {value:'all',label:'All'}, {value:'available',label:'Available'}, {value:'pending',label:'Pending'},
  {value:'approved',label:'Accepted'}, {value:'declined',label:'Declined'},
  {value:'cancelled',label:'Cancelled'}, {value:'failed',label:'Failed'},
] as const;
export const requestSegments=requestStates.filter(state=>!['all','cancelled','failed'].includes(state.value));
export const requestFeedSchema=v.object({
  state:v.optional(v.picklist(['available','pending','approved','declined']),'available'),
  kind:v.optional(v.picklist(['all','movie','show']),'all'),
  page:v.optional(v.pipe(v.number(),v.integer(),v.minValue(1),v.maxValue(1_000_000)),1),
  preview:v.optional(v.boolean(),false),
});
export type LibraryFeedContent={items:ShelfItem[];page:number;pages:number;total:number};
export function requestFeedCard(item:MediaView,request:{id:string;state:string;destination:string;createdAt:Date|string},actor?:{username:string;avatar?:string|null}):MediaView{
  const label=requestStates.find(state=>state.value===request.state)?.label??'Unknown';
  return {...item,entryId:request.id,captionActor:actor,
    captionSubtitle:`Requested · ${request.destination}`,captionDate:actor?new Date(request.createdAt).toISOString():undefined,
    captionStatus:{label,href:`/requests?request=${request.id}`,
      icon:request.state==='available'?'check':request.state==='pending'?'clock':request.state==='approved'?'check':'close',
      tone:request.state==='available'?'positive':['pending','approved'].includes(request.state)?'pending':'negative'},
  };
}
