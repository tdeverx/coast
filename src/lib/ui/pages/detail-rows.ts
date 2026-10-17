import type {Snippet} from 'svelte';
import type {InsightPanel} from '../insights/types';
import type {MediaCardPresentation} from '../types';
import type {FilterGroup} from '../controls/filters';
import type {Review} from '$lib/media/details';
export type DetailFailure={title:string;message:string;retry:()=>unknown};
export type DetailTab={value:string;label:string;panels?:InsightPanel[];content?:Snippet;filters?:FilterGroup[];busy?:boolean;errors?:DetailFailure[]};
export type DetailRowsModel={
 insights?:{selection:string;select?:(value:string)=>void;tabs:DetailTab[];activate?:()=>void;href?:string};
 credits?:{selection:string;select?:(value:string)=>void;groups:{value:string;label:string;people:MediaCardPresentation[];busy?:boolean}[];activate?:()=>void;href?:string;errors?:DetailFailure[];hideEmpty?:boolean};
 reviews?:{selection:string;select?:(value:string)=>void;options:{value:string;label:string}[];items:(Review&{source:string})[];busy:boolean;errors:DetailFailure[];activate?:()=>void;href?:string;more?:()=>unknown};
};
export function detailHref(path:string,values:Record<string,string|undefined>){
 const url=new URL(path,'http://coast');for(const [key,value]of Object.entries(values)){if(value===undefined)url.searchParams.delete(key);else url.searchParams.set(key,value);}return url.pathname+url.search;
}
