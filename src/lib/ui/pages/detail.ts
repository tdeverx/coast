import type {ComponentProps} from 'svelte';
import type MediaPage from '../components/MediaPage.svelte';
import type Shelf from '../components/Shelf.svelte';
/** The detail composition consumes the real shared Shelf contract, including its lazy source. */
export type DetailRow={key:string;shelf:ComponentProps<typeof Shelf>};
export type DetailPage=Omit<ComponentProps<typeof MediaPage>,'children'|'details'|'sections'|'heroActions'>;

/** Durable identity, never a provider/UI-only ID; containers use verified membership. */
export function detailActivity(item?:import('../heroes/presentation.svelte').HeroItem){
 if(!item||item.kind==='person')return;
 const uuid=(id:unknown):id is string=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
 const group=item.id.startsWith('reading-group:')?item.id.slice('reading-group:'.length):undefined;
 if(uuid(group))return {readingGroupId:group,category:'reading'};
 if(item.kind==='artist')return 'artistId' in item&&uuid(item.artistId)?{artistId:item.artistId,category:'music'}:undefined;
 const work='workId' in item?item.workId??item.id:item.id;
 if(!uuid(work))return;
 return {workId:work,category:['book','comic'].includes(item.kind)?'reading':['album','track'].includes(item.kind)?'music':item.kind==='game'?'game':'screen'};
}
