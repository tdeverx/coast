import type { Snippet } from 'svelte';
import type { JournalEntry } from '$lib/profile/journal';
import type { MediaView, MediaCardPresentation, MediaCardShape, MediaCardArtwork, ArtworkPriority } from '$lib/ui/types';
import type { SequenceContext } from '$lib/media/sequence';
export type ShelfItem = MediaView | MediaCardPresentation;
export type ShelfControl = {
  type: 'segments' | 'select' | 'availability' | 'media-type';
  label: string;
  value: string;
  options?: { value: string; label: string }[];
  includeOtherMedia?: boolean;
  change: (value: string) => unknown;
};
export type ShelfAction = { label: string; run: () => unknown };
export type ShelfItemDetails = { summary?: string; body?: string; actions?: { label: string; icon: 'left' | 'right' | 'close'; disabled?: boolean; run: () => unknown }[] };
export type ShelfGroup = {
  title:string; heading?:string; count?:number; items:ShelfItem[]; runs?:JournalEntry[][];
  href?:string; controls?:Snippet; preserveHeight?:boolean;
  selection?:{checked:(id:string)=>boolean;toggle:(id:string)=>void;disabled?:boolean};
};
export type ShelfPagination =
  | { kind: 'local' }
  | { kind: 'cursor'; hasMore: boolean }
  | { kind: 'pages'; page: number; pages: number; append: boolean; controls: 'none' | 'header' | 'footer' | 'both'; url?: (page: number) => string };
export interface ShelfSource {
  readonly pagination: ShelfPagination;
  readonly groups?: ShelfGroup[];
  readonly appendOnly?: boolean;
  readonly loadMoreLabel?: string;
  readonly title: string;
  readonly items: ShelfItem[];
  readonly busy: boolean;
  readonly ready: boolean;
  readonly error: string;
  readonly activated: boolean;
  readonly href?: string;
  readonly filters: ShelfControl[];
  readonly controls: ShelfControl[];
  readonly shape?: MediaCardShape;
  readonly artworkStyle?: MediaCardArtwork;
  readonly artworkPriority?: ArtworkPriority;
  readonly mediaKind?: 'screen' | 'music' | 'game';
  readonly rows?: 1 | 2;
  readonly resetKey?: string;
  readonly empty?: string;
  readonly emptyHref?: string;
  readonly emptyLink?: string;
  readonly retryLabel?: string;
  readonly notice?: string;
  readonly sequence?: Pick<SequenceContext, 'kind' | 'id'>;
  readonly filterBy?: 'none' | 'type' | 'watched';
  readonly actions?: ShelfAction[];
  details?: (item: ShelfItem) => ShelfItemDetails | undefined;
  load: (page?: number, append?: boolean) => Promise<unknown>;
}
