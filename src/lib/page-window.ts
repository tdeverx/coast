/** A native-page neighborhood. Page widths belong to each catalogue, not the UI. */
export const RETAINED_PAGE_LIMIT = 3;
export const ROW_BATCH_SIZE = 20;
export type PageWindow = { firstPage: number; lastPage: number; counts: number[] };
export type PageInterval = Pick<PageWindow, 'firstPage' | 'lastPage'>;

export function validPageInterval(firstPage: number, lastPage: number) {
  return Number.isInteger(firstPage) && Number.isInteger(lastPage)
    && firstPage >= 1 && lastPage <= 1_000_000 && firstPage <= lastPage
    && lastPage - firstPage < RETAINED_PAGE_LIMIT;
}

/** Count first, then clamp both ends without widening the requested neighborhood. */
export function pageInterval(pages: number, page: number, firstPage = page): PageInterval {
  return { firstPage: Math.min(firstPage, pages), lastPage: Math.min(page, pages) };
}

export type NativePage<Item> = { page: number; items: Item[] };
export type WindowContent<Item> = {
  items: Item[]; page: number; pages: number; range?: PageWindow;
  retainedPages?: NativePage<Item>[];
};

export function retainedInterval<Item>(content: WindowContent<Item>): PageInterval {
  return {
    firstPage: content.retainedPages?.[0]?.page ?? content.range?.firstPage ?? content.page,
    lastPage: content.retainedPages?.at(-1)?.page ?? content.range?.lastPage ?? content.page,
  };
}

function nativePages<Item>(content: WindowContent<Item>): NativePage<Item>[] {
  if (content.retainedPages) return content.retainedPages;
  if (!content.range) return [{page:content.page,items:content.items}];
  const {firstPage,lastPage,counts} = content.range;
  if (!validPageInterval(firstPage,lastPage) || lastPage !== content.page
    || counts.length !== lastPage-firstPage+1 || counts.some(count=>!Number.isInteger(count)||count<0)
    || counts.reduce((sum,count)=>sum+count,0) !== content.items.length)
    throw new Error('The catalogue range is incomplete. Retry loading it.');
  let offset=0;
  return counts.map((count,index)=>{
    const items=content.items.slice(offset,offset+count); offset+=count;
    return {page:firstPage+index,items};
  });
}

/** Resource owns requests/publication; this owns only a bounded native-page neighborhood. */
export function retainPageWindow<Item, Content extends WindowContent<Item>>(
  previous: Content, incoming: Content, direction: 'replace'|'append'|'prepend', key:(item:Item)=>string
): Content {
  const pages=new Map<number,NativePage<Item>>();
  if (direction!=='replace') for (const page of nativePages(previous)) pages.set(page.page,page);
  for (const page of nativePages(incoming)) pages.set(page.page,page);
  const ordered=[...pages.values()].filter(page=>page.page<=incoming.pages).sort((a,b)=>a.page-b.page);
  if (ordered.some((page,index)=>index>0 && page.page!==ordered[index-1].page+1))
    throw new Error('The catalogue pages changed. Retry loading this range.');
  const retainedPages=direction==='prepend'?ordered.slice(0,RETAINED_PAGE_LIMIT):ordered.slice(-RETAINED_PAGE_LIMIT);
  if (!retainedPages.length) throw new Error('The catalogue range is empty. Retry loading it.');
  const items=[...new Map(retainedPages.flatMap(page=>page.items).map(item=>[key(item),item])).values()];
  return {...incoming,range:undefined,retainedPages,items,page:retainedPages.at(-1)!.page};
}

/** Backpressure preserves active owners without letting pinned pages grow the buffer. */
export function createPageRetention(onRelease:()=>void=()=>{}) {
  const owners=new Map<string,Set<symbol>>();
  return {
    retain(key:string) {
      const token=Symbol(), leases=owners.get(key)??new Set<symbol>();
      owners.set(key,leases); leases.add(token);
      return ()=>{
        if(!leases.delete(token))return;
        if(owners.get(key)!==leases)return;
        if(!leases.size && owners.get(key)===leases)owners.delete(key);
        onRelease();
      };
    },
    canRelease(previous:readonly string[],next:readonly string[]) {
      const retained=new Set(next);
      return previous.every(key=>!owners.has(key)||retained.has(key));
    },
    retire() { owners.clear(); },
  };
}
