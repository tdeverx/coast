import * as v from 'valibot';

export const readingKinds = ['book', 'comic'] as const;
export type ReadingKind = (typeof readingKinds)[number];
export type ReadingProvider = 'openlibrary' | 'comic-vine';
export const readingStates = ['planned', 'reading', 'completed', 'paused', 'dropped'] as const;
export type ReadingState = (typeof readingStates)[number];
export const readingFormats = ['pdf', 'epub', 'cbz'] as const;
export type ReadingFormat = (typeof readingFormats)[number];
const readerPage = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100000));
/** EPUB uses a canonical fragment identifier, never a layout-dependent page number. */
export const readingLocationSchema = v.variant('format', [
  v.strictObject({ format: v.literal('pdf'), page: readerPage, total: readerPage }),
  v.strictObject({ format: v.literal('cbz'), page: readerPage, total: readerPage }),
  v.strictObject({ format: v.literal('epub'), cfi: v.pipe(v.string(), v.maxLength(2000), v.regex(/^epubcfi\([^\u0000-\u001f]*\)$/)), fraction: v.pipe(v.number(), v.minValue(0), v.maxValue(1)) }),
]);
export type ReadingLocation = v.InferOutput<typeof readingLocationSchema>;
/** EPUB fractions depend on viewport layout; the CFI is the synchronized identity. */
export function sameReadingLocation(a: ReadingLocation | null | undefined, b: ReadingLocation | null | undefined) {
  if (!a || !b) return a === b;
  return a.format === b.format && (a.format === 'epub' && b.format === 'epub'
    ? a.cfi === b.cfi : a.format !== 'epub' && b.format !== 'epub' && a.page === b.page && a.total === b.total);
}
export function readingFraction(location: ReadingLocation | null | undefined) {
  return location ? location.format === 'epub' ? location.fraction : location.page / location.total : 0;
}
export function readingLocationLabel(location: ReadingLocation | null | undefined) {
  return !location ? 'Reading' : location.format === 'epub' ? `${Math.round(location.fraction * 100)}% read` : `Page ${location.page} of ${location.total}`;
}
export function readingFormat(filename: string): ReadingFormat | null {
  const extension = filename.toLowerCase().split('.').pop();
  return readingFormats.includes(extension as ReadingFormat) ? extension as ReadingFormat : null;
}
export type ReadingSessionView = {
  id: string; workId: string; title: string; format: ReadingFormat; edition: string;
  location: ReadingLocation | null; url: string | null; source: 'local' | 'jellyfin';
};
export const READING_PROVIDER_PAGE_LIMIT = 1000;
export const openLibraryIdSchema = v.pipe(v.string(), v.regex(/^OL[1-9][0-9]{0,19}W$/));
export const openLibraryEditionIdSchema = v.pipe(v.string(), v.regex(/^OL[1-9][0-9]{0,19}M$/));
export const comicVineIdSchema = v.pipe(v.string(), v.regex(/^4000-[1-9][0-9]{0,14}$/), v.check(id => Number.isSafeInteger(Number(id.slice(5)))));
/** A reading reference identifies a work or issue, never an edition or a Comic Vine series. */
export const readingReferenceSchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('book'), externalId: openLibraryIdSchema }),
  v.strictObject({ kind: v.literal('comic'), externalId: v.union([comicVineIdSchema, openLibraryIdSchema]) }),
]);
export const readingIdentitySchema = v.variant('provider', [
  v.strictObject({ provider: v.literal('openlibrary'), externalId: openLibraryIdSchema }),
  v.strictObject({ provider: v.literal('comic-vine'), externalId: comicVineIdSchema }),
]);
export type ReadingIdentity = v.InferOutput<typeof readingIdentitySchema>;
export const readingProviderForId = (id: string): ReadingProvider => id.startsWith('OL') ? 'openlibrary' : 'comic-vine';

/** Subject labels describe a work's medium; the metadata source does not. */
export function openLibraryKind(subjects: string[]): ReadingKind {
  return subjects.some(subject => /\b(comic books|comics|graphic novels|manga|bandes dessin[ée]es)\b/i.test(subject)) ? 'comic' : 'book';
}

export interface ReadingMetadata {
  provider: ReadingProvider;
  externalId: string;
  kind: ReadingKind;
  title: string;
  overview?: string;
  coverUrl?: string;
  sourceUrl: string;
  authors: string[];
  subjects: string[];
  publishedYear?: number;
  releaseDate?: string;
  pageCount?: number;
  seriesTitle?: string;
  issueNumber?: string;
  editionIds?: string[];
  /** Explicit provider cross-references only; titles and ISBN edition groups are not identities. */
  identities?: ReadingIdentity[];
}

export interface ReadingPage {
  items: ReadingMetadata[];
  total: number;
  nextPage: number | null;
  page: number;
}

/** Provider descriptions are displayed as escaped text, never HTML. */
export function readingPlainText(value: string): string {
  const entities: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  };
  return value
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? match;
      const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point) : '';
    })
    .replace(/<!--[^]*?(?:-->|$)/g, ' ')
    .replace(/<(script|style)\b[^>]*>[^]*?(?:<\/\1\s*>|$)/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
