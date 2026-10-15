import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { readingMetadataSchema } from '../src/lib/catalogue/reading.server';
import { readingProgressInputSchema } from '../src/lib/core/reading/service.server';
import { readingCatalogueSchema } from '../src/lib/reading/query.server';
import { readingReferenceSchema } from '../src/lib/reading/model';

describe('reading metadata and page contracts', () => {
  test('requires canonical provider work identities and bounded metadata', () => {
    const book = { provider: 'openlibrary', externalId: 'OL1W', kind: 'book', title: 'A book', sourceUrl: 'https://openlibrary.org/works/OL1W', authors: [], subjects: [] };
    expect(v.safeParse(readingMetadataSchema, book).success).toBe(true);
    expect(v.safeParse(readingMetadataSchema, { ...book, externalId: 'OL1M' }).success).toBe(false);
    expect(v.safeParse(readingMetadataSchema, { ...book, externalId: 'OL01W' }).success).toBe(false);
    expect(v.safeParse(readingMetadataSchema, { ...book, externalId: `OL${'1'.repeat(21)}W` }).success).toBe(false);
    expect(v.safeParse(readingMetadataSchema, { ...book, kind: 'comic' }).success).toBe(true);
    expect(v.safeParse(readingMetadataSchema, { ...book, pageCount: 0 }).success).toBe(false);
    expect(v.safeParse(readingMetadataSchema, { ...book, authors: Array(51).fill('Author') }).success).toBe(false);
    expect(v.safeParse(readingMetadataSchema, { ...book, provider: 'comic-vine', kind: 'comic', externalId: '4000-1' }).success).toBe(true);
    expect(v.safeParse(readingMetadataSchema, { ...book, provider: 'comic-vine', kind: 'comic', externalId: '4050-1' }).success).toBe(false);
    expect(v.safeParse(readingMetadataSchema, { ...book, provider: 'comic-vine', kind: 'comic', externalId: '4000-0' }).success).toBe(false);
    expect(v.safeParse(readingReferenceSchema, { kind: 'book', externalId: 'OL1W' }).success).toBe(true);
    expect(v.safeParse(readingReferenceSchema, { kind: 'comic', externalId: '4000-1' }).success).toBe(true);
    expect(v.safeParse(readingReferenceSchema, { kind: 'book', externalId: 'OL1M' }).success).toBe(false);
    expect(v.safeParse(readingReferenceSchema, { kind: 'comic', externalId: '4050-1' }).success).toBe(false);
    expect(v.safeParse(readingReferenceSchema, { kind: 'book', externalId: 'OL1W', extra: true }).success).toBe(false);
  });
  test('progress uses whole pages and explicit reading states', () => {
    expect(v.parse(readingProgressInputSchema, { page: 0, totalPages: null })).toEqual({ page: 0, totalPages: null });
    expect(v.safeParse(readingProgressInputSchema, { state: 'completed' }).success).toBe(true);
    for (const input of [{}, { page: -1 }, { page: 1.5 }, { page: Infinity }, { page: 1000001 }, { totalPages: 0 }, { page: 11, totalPages: 10 }, { state: 'watching' }, { positionSeconds: 5 }])
      expect(v.safeParse(readingProgressInputSchema, input).success).toBe(false);
  });
  test('catalogue pages and filters have the shared bounded vocabulary', () => {
    expect(v.parse(readingCatalogueSchema, {})).toEqual({ kind: 'all', search: '', page: 1, state: 'all', available:false, personal: true });
    expect(v.safeParse(readingCatalogueSchema, { page: 0 }).success).toBe(false);
    expect(v.safeParse(readingCatalogueSchema, { kind: 'game' }).success).toBe(false);
    expect(v.safeParse(readingCatalogueSchema, { state: 'watched' }).success).toBe(false);
    expect(v.safeParse(readingCatalogueSchema, { page: 1001 }).success).toBe(true);
  });
});
