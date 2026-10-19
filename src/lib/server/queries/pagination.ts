import * as v from 'valibot';
import { validPageInterval, type PageInterval } from '$lib/page-window';

export const PAGE_SIZE = 60;
export const pageNumberSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(1),
  v.maxValue(1_000_000)
);

/** Keep every paged read model on the same bounds, including an empty result. */
export function pagination(total: number, requestedPage: number) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return { page: Math.min(requestedPage, pages), pages };
}

/** Only an explicitly requested bounded range changes ordinary numbered-page DTOs. */
export function requestedPageInterval(page: number, firstPage?: unknown): PageInterval | undefined {
  v.parse(pageNumberSchema, page);
  if (firstPage === undefined || firstPage === null) return;
  return v.parse(v.pipe(v.object({ firstPage: pageNumberSchema, lastPage: pageNumberSchema }),
    v.check(value => validPageInterval(value.firstPage, value.lastPage), 'Choose at most three ordered pages.')),
  { firstPage: typeof firstPage === 'string' ? Number(firstPage) : firstPage, lastPage: page });
}
