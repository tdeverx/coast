import type {ComponentProps} from 'svelte';
import type MediaPage from '../components/MediaPage.svelte';
import type Shelf from '../components/Shelf.svelte';
import type {MediaCardPresentation,MediaView} from '../types';
import type {FeatureValues} from '#lib/features.js';
import type {TasteGroup} from '#lib/social/collection-taste.server.js';
/** The detail composition consumes the real shared Shelf contract, including its lazy source. */
export type DetailRow={key:string;shelf:ComponentProps<typeof Shelf>};
export type DetailPage=Omit<ComponentProps<typeof MediaPage>,'children'|'details'|'sections'|'heroActions'>;

const uuid=(id:unknown):id is string=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** A reading volume is a container with its own route, not a screen work or playlist. */
export function readingVolumeId(item: {id: string; kind: string; href?: string|null}) {
 if (item.kind !== 'collection' || !item.href) return;
 const id = item.id.replace(/^reading-group:/, '');
 if (uuid(id) && item.href === `/media/reading-collection/${id}`) return id;
}

/** The layout exposes the resolved permissions, including experimental medium gates. */
export function canShowTaste(item: MediaView | MediaCardPresentation | undefined, capabilities: FeatureValues) {
 if (!item || !capabilities.personalisation) return false;
 switch (item.kind) {
  case 'movie': case 'show': case 'season': case 'episode': return capabilities.screen;
  case 'collection': return readingVolumeId(item) ? capabilities.comic : capabilities.screen;
  case 'album': case 'artist': case 'track': return capabilities.music;
  case 'book': case 'comic': case 'game': return capabilities[item.kind];
  default: return false;
 }
}

/** Catalogue cards can carry provider IDs until the action menu resolves the work. */
export function detailTaste(item?: MediaView | MediaCardPresentation, resolvedWorkId?: string): {workId: string; group?: TasteGroup} | undefined {
 if (!item || item.kind === 'person') return;
 if (item.kind === 'collection' && 'href' in item) {
  const group = readingVolumeId(item);
  if (group) return {workId: group, group: 'reading-group'};
  if (!item.workId) return;
 }
 const workId = resolvedWorkId ?? ('href' in item ? item.workId : item.id);
 if (!uuid(workId)) return;
 return item.kind === 'collection' ? {workId, group: 'collection'} : {workId};
}

/** Durable identity, never a provider/UI-only ID; containers use verified membership. */
export function detailActivity(item?:import('../heroes/presentation.svelte').HeroItem){
 if(!item||item.kind==='person')return;
 const group=item.id.startsWith('reading-group:')?item.id.slice('reading-group:'.length):undefined;
 if(uuid(group))return {readingGroupId:group,category:'reading'};
 if(item.kind==='artist'){
  const artist='workId' in item&&uuid(item.workId)?item.workId:'artistId' in item&&uuid(item.artistId)?item.artistId:undefined;
  return artist?{artistId:artist,category:'music'}:undefined;
 }
 const work='workId' in item?item.workId??item.id:item.id;
 if(!uuid(work))return;
 return {workId:work,category:['book','comic'].includes(item.kind)?'reading':['album','track'].includes(item.kind)?'music':item.kind==='game'?'game':'screen'};
}
