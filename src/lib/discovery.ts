import type { ShelfItem } from './ui/shelves/types';
export type DiscoverySurface='watch'|'play'|'listen'|'read';
export type DiscoverySection='trending'|'recent';
export type DiscoveryContent={items:ShelfItem[];failure:string;notice?:string;page?:number;pages?:number;total?:number};
export const discoveryTitles={trending:'Trending now',recent:'Recently released'};
export const discoverySegments=[{value:'watch',label:'Watch'},{value:'play',label:'Play'},{value:'listen',label:'Listen'},{value:'read',label:'Read'}];
