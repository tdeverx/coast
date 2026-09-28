import * as v from 'valibot';

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
