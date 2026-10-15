import * as v from 'valibot';
import type { ProviderTransport } from '../contracts';
import { readingFormat } from '$lib/reading/model';
import { jellyfinItemKey, validateJellyfinPage } from './paging';
const id = v.pipe(v.string(), v.regex(/^[a-f0-9-]{32,36}$/i));
const bookSchema = v.object({
  Id: id, Type: v.literal('Book'), Name: v.nullish(v.string()), Path: v.nullish(v.string()),
  Container: v.nullish(v.string()), Etag: v.nullish(v.string()), DateModified: v.nullish(v.string()),
  Size: v.nullish(v.number()), ProviderIds: v.optional(v.record(v.string(),v.string()),{}),
});
export type JellyfinBook = v.InferOutput<typeof bookSchema>;
export async function jellyfinBook(call: ProviderTransport, userId: string, externalId: string) {
  v.parse(id,externalId);
  const item = v.parse(bookSchema,await call(`/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(externalId)}?Fields=Path,ProviderIds,DateModified,Size`));
  if(jellyfinItemKey(item.Id)!==jellyfinItemKey(externalId)) throw new Error('Jellyfin returned a different reading file.');
  return item;
}
export async function jellyfinBookPage(call: ProviderTransport, userId: string, search: string, offset = 0) {
  const query = new URLSearchParams({userId,IncludeItemTypes:'Book',Recursive:'true',StartIndex:String(offset),Limit:'60',Fields:'Path,ProviderIds,DateModified,Size',SortBy:'SortName',SortOrder:'Ascending'});
  if(search)query.set('SearchTerm',search);
  const page=v.parse(v.object({Items:v.array(bookSchema),TotalRecordCount:v.number(),StartIndex:v.optional(v.number())}),await call(`/Items?${query}`));
  validateJellyfinPage(page,offset,60,'library');
  return {items:page.Items,total:page.TotalRecordCount,nextOffset:offset+page.Items.length<page.TotalRecordCount?offset+page.Items.length:null};
}
export function bookFormat(book:JellyfinBook) {
  return readingFormat(book.Path??`book.${book.Container??''}`);
}

export async function jellyfinBooks(call:ProviderTransport,userId:string,search:string,offset=0){const page=await jellyfinBookPage(call,userId,search,offset);return {...page,items:page.items.map(book=>({id:book.Id,title:book.Name||'Untitled',format:bookFormat(book)}))};}
