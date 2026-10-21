import * as v from 'valibot';
import type { ProviderTransport } from '../contracts';
import { comicVineIdSchema, openLibraryIdSchema, openLibraryEditionIdSchema, readingFormat } from '#lib/reading/model.js';
import { jellyfinItemKey, validateJellyfinPage } from './paging';
const id = v.pipe(v.string(), v.regex(/^[a-f0-9-]{32,36}$/i));
const bookSchema = v.object({
  Id: id, Type: v.literal('Book'), Name: v.nullish(v.string()), Path: v.nullish(v.string()),
  Container: v.nullish(v.string()), Etag: v.nullish(v.string()), DateModified: v.nullish(v.string()),
  Size: v.nullish(v.number()), ProviderIds: v.optional(v.record(v.string(),v.string()),{}),
});
export type JellyfinBook = v.InferOutput<typeof bookSchema>;
export function jellyfinOpenLibraryId(value: string | undefined): string | null {
  if (!value) return null;
  let path = value.trim();
  if (/^https?:\/\//.test(path)) {
    try {
      const url = new URL(path);
      if (!['https://openlibrary.org','http://openlibrary.org'].includes(url.origin) || url.username || url.password || url.search || url.hash) return null;
      path = url.pathname;
    } catch { return null; }
  }
  const match = /^(?:\/?(works|books)\/)?(OL[1-9][0-9]{0,19}[WM])\/?$/.exec(path);
  if (!match || match[1] && (match[1] === 'works') !== match[2].endsWith('W')) return null;
  return v.safeParse(match[2].endsWith('W') ? openLibraryIdSchema : openLibraryEditionIdSchema, match[2]).success ? match[2] : null;
}
/** Jellyfin's Comic Vine plugin stores issue permalinks as well as bare IDs.
 * Normalize only explicit issue identities; never infer one from a title or volume. */
export function jellyfinComicVineId(value: string | undefined): string | null {
  if (!value) return null;
  let path = value.trim();
  if (path.startsWith('https://')) {
    try {
      const url = new URL(path);
      if (url.origin !== 'https://comicvine.gamespot.com' || url.username || url.password || url.search || url.hash) return null;
      path = url.pathname;
    } catch { return null; }
  }
  const match = /^\/?(?:[A-Za-z0-9][A-Za-z0-9-]*\/)?(4000-[1-9][0-9]{0,14})\/?$/.exec(path);
  return match && v.safeParse(comicVineIdSchema, match[1]).success ? match[1] : null;
}
export async function jellyfinBook(call: ProviderTransport, userId: string, externalId: string, signal?:AbortSignal) {
  signal?.throwIfAborted();
  v.parse(id,externalId);
  const item = v.parse(bookSchema,await call(`/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(externalId)}?Fields=Path,ProviderIds,DateModified,Size`,{signal}));
  if(jellyfinItemKey(item.Id)!==jellyfinItemKey(externalId)) throw new Error('Jellyfin returned a different reading file.');
  return {...item,Id:jellyfinItemKey(item.Id)};
}
export async function jellyfinBookPage(call: ProviderTransport, userId: string, search: string, offset = 0) {
  const query = new URLSearchParams({userId,IncludeItemTypes:'Book',Recursive:'true',StartIndex:String(offset),Limit:'60',Fields:'Path,ProviderIds,DateModified,Size',SortBy:'SortName',SortOrder:'Ascending'});
  if(search)query.set('SearchTerm',search);
  const page=v.parse(v.object({Items:v.array(bookSchema),TotalRecordCount:v.number(),StartIndex:v.optional(v.number())}),await call(`/Items?${query}`));
  validateJellyfinPage(page,offset,60,'library');
  return {items:page.Items.map(item=>({...item,Id:jellyfinItemKey(item.Id)})),total:page.TotalRecordCount,nextOffset:offset+page.Items.length<page.TotalRecordCount?offset+page.Items.length:null};
}
export function bookFormat(book:JellyfinBook) {
  return readingFormat(book.Path??`book.${book.Container??''}`);
}

export async function jellyfinBooks(call:ProviderTransport,userId:string,search:string,offset=0){const page=await jellyfinBookPage(call,userId,search,offset);return {...page,items:page.items.map(book=>({id:book.Id,title:book.Name||'Untitled',format:bookFormat(book)}))};}
