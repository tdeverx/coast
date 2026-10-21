import {sql,type SQLWrapper,type SQL} from 'drizzle-orm';
import type {LibrarySort} from '#lib/library.js';

/** Fixed expressions only; every order includes identity for stable native pages. */
export function libraryOrder(sort:LibrarySort, columns:{title:SQLWrapper;added:SQLWrapper;id:SQLWrapper}, fallback?:SQL){
  const {title,added,id}=columns;
  return sort==='title'?sql`lower(${title}) asc, ${id} asc`
    :sort==='title-desc'?sql`lower(${title}) desc, ${id} asc`
    :sort==='added'?sql`${added} desc, ${id} asc`
    :sort==='added-asc'?sql`${added} asc, ${id} asc`
    :fallback??sql`lower(${title}) asc, ${id} asc`;
}
