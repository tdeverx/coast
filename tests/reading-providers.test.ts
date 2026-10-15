import { describe, expect, test } from 'bun:test';
import { OpenLibraryAdapter } from '../src/lib/providers/openlibrary/adapter.server';
import { ComicVineAdapter } from '../src/lib/providers/comic-vine/adapter.server';
import { readingPlainText, READING_PROVIDER_PAGE_LIMIT } from '../src/lib/reading/model';
import { ProviderHttpError } from '../src/lib/server/security/provider-fetch';
import { readingCard, readingHero } from '../src/lib/reading/presentation';

const book = { key: '/works/OL123W', title: 'A Book', author_name: ['Writer'], subject: ['Fiction'], first_publish_year: 2001, cover_i: 42, edition_key: ['OL456M'] };
const issue = { id: 123, site_detail_url: 'https://comicvine.gamespot.com/a-series-12/4000-123/', resource_type: 'issue', name: null, issue_number: '½', volume: { id: 456, name: 'A Series' }, description: '<p>A &amp; B</p><script>unsafe()</script>', store_date: '2001-02-03', image: { super_url: 'https://comicvine.gamespot.com/a/uploads/scale_large/1/2/123-cover.jpg' }, person_credits: [{ name: 'Writer', role: 'writer' }, { name: 'Artist', role: 'penciler' }] };

describe('experimental Open Library book provider', () => {
  test('search uses one paged request and retains work and edition identities separately', async () => {
    const paths: string[] = [];
    const adapter = new OpenLibraryAdapter(async path => {
      paths.push(path);
      const params = new URL(path, 'https://openlibrary.org').searchParams;
      expect(params.get('q')).toBe('book & writer');
      expect(params.get('page')).toBe('2');
      expect(params.get('limit')).toBe('20');
      expect(params.get('fields')).not.toBe('*');
      return { docs: [book], numFound: 41 };
    });
    const result = await adapter.search('book & writer', 2);
    expect(paths).toHaveLength(1);
    expect(result.nextPage).toBe(3);
    expect(result.total).toBe(41);
    expect(result.items[0]).toMatchObject({ provider: 'openlibrary', kind: 'book', externalId: 'OL123W', authors: ['Writer'], editionIds: ['OL456M'], sourceUrl: 'https://openlibrary.org/works/OL123W', coverUrl: 'https://covers.openlibrary.org/b/id/42-L.jpg?default=false' });
    expect(result.items[0].pageCount).toBeUndefined();
  });
  test('details read the exact work and one indexed result without author or edition fanout', async () => {
    const paths: string[] = [];
    const adapter = new OpenLibraryAdapter(async path => {
      paths.push(path);
      if (path === '/works/OL123W.json') return { key: '/works/OL123W', title: 'A Book', description: { value: '<p>A &quot;book&quot;</p><style>bad</style>' }, covers: [-1, 42], subjects: ['Work subject'] };
      const params = new URL(path, 'https://openlibrary.org').searchParams;
      expect(params.get('q')).toBe('key:/works/OL123W');
      expect(params.get('limit')).toBe('1');
      return { docs: [book], num_found: 1 };
    });
    const result = await adapter.details('OL123W');
    expect(paths).toHaveLength(2);
    expect(result.overview).toBe('A "book"');
    expect(result.subjects).toEqual(['Work subject']);
    expect(result.authors).toEqual(['Writer']);
  });
  test('invalid identity, pagination and mismatched detail identity fail before ingestion', async () => {
    let calls = 0;
    const adapter = new OpenLibraryAdapter(async () => { calls++; return { key: '/works/OL999W', title: 'Other' }; });
    await expect(adapter.details('OL456M')).rejects.toThrow();
    await expect(adapter.search('book', 0)).rejects.toThrow();
    expect(calls).toBe(0);
    await expect(adapter.details('OL123W')).rejects.toThrow('different work identity');
    expect(calls).toBe(1);
    await expect(new OpenLibraryAdapter(async () => ({ docs: [book] })).search('book')).rejects.toThrow('pagination');
    await expect(new OpenLibraryAdapter(async () => ({ docs: [{ ...book, key: '/books/OL456M' }], numFound: 1 })).search('book')).rejects.toThrow('valid book metadata');
  });
  test('transport cooldown failures preserve the upstream retry policy', async () => {
    const failure = new ProviderHttpError(429, 30);
    await expect(new OpenLibraryAdapter(async () => { throw failure; }).search('book')).rejects.toBe(failure);
  });
});

describe('experimental Comic Vine issue provider', () => {
  test('search is limited to ten issues and maps fractional issue labels without volume identity merges', async () => {
    let calls = 0;
    const adapter = new ComicVineAdapter('secret-key', async (path, init) => {
      calls++;
      const url = new URL(path, 'https://comicvine.gamespot.com');
      expect(url.pathname).toBe('/api/search/');
      if (url.searchParams.get('resources') === 'volume') return { status_code: 1, results: [] };
      expect(url.searchParams.get('resources')).toBe('issue');
      expect(url.searchParams.get('limit')).toBe('10');
      expect(url.searchParams.get('offset')).toBe('10');
      expect(url.searchParams.get('api_key')).toBe('secret-key');
      expect(url.searchParams.get('format')).toBe('json');
      expect(new Headers(init?.headers).get('User-Agent')).toContain('Coast');
      return { status_code: 1, number_of_total_results: 21, results: [issue] };
    });
    const result = await adapter.search('A Series', 2);
    expect(result.nextPage).toBe(3);
    expect(result.items[0]).toMatchObject({ provider: 'comic-vine', kind: 'comic', externalId: '4000-123', title: 'A Series #½', seriesTitle: 'A Series', issueNumber: '½', authors: ['Writer'], overview: 'A & B', publishedYear: 2001, sourceUrl: issue.site_detail_url });
    expect(result.items[0].coverUrl).toBe(issue.image.super_url);
    expect(JSON.stringify(result)).not.toContain('secret-key');
    expect(calls).toBe(2);
  });
  test('details use the fixed issue path and reject a different returned identity', async () => {
    const adapter = new ComicVineAdapter('key', async path => {
      expect(new URL(path, 'https://comicvine.gamespot.com').pathname).toBe('/api/issue/4000-123/');
      return { status_code: 1, results: issue };
    });
    expect((await adapter.details('4000-123')).externalId).toBe('4000-123');
    await expect(new ComicVineAdapter('key', async () => ({ status_code: 1, results: { ...issue, id: 999 } })).details('4000-123')).rejects.toThrow('different issue identity');
  });
  test('invalid or volume identities fail before requesting, and API denials never expose the key or upstream body', async () => {
    let calls = 0;
    const adapter = new ComicVineAdapter('secret-key', async () => { calls++; return { status_code: 100, error: 'secret-key' }; });
    for (const id of ['4050-123', '123', '4000-123/../../volume/4050-1', '4000-9007199254740992'])
      await expect(adapter.details(id)).rejects.toThrow();
    expect(calls).toBe(0);
    const denial = await adapter.search('comic').catch(error => error);
    expect(denial.message).toBe('Comic Vine rejected its API key.');
    // An integration key failure must not expire the user's Coast session.
    expect(denial.status).toBe(502);
    expect(JSON.stringify(denial)).not.toContain('secret-key');
    await expect(new ComicVineAdapter('key', async () => ({ status_code: 101 })).details('4000-123')).rejects.toThrow('not found');
    await expect(new ComicVineAdapter('key', async () => ({ status_code: 1, number_of_total_results: 1, results: [{ ...issue, resource_type: 'volume' }] })).search('comic')).rejects.toThrow('valid comic metadata');
  });
  test('unapproved cover origins and paths are dropped while upstream Retry-After survives', async () => {
    for (const raw of ['https://evil.example/cover.jpg', 'http://comicvine.gamespot.com/a/uploads/cover.jpg', 'https://comicvine.gamespot.com.evil.example/a/uploads/cover.jpg', 'https://comicvine.gamespot.com/a/uploads/cover.jpg?api_key=secret', 'https://comicvine.gamespot.com/api/search/']) {
      const adapter = new ComicVineAdapter('key', async () => ({ status_code: 1, results: { ...issue, image: { super_url: raw } } }));
      expect((await adapter.details('4000-123')).coverUrl).toBeUndefined();
    }
    const failure = new ProviderHttpError(429, 60);
    await expect(new ComicVineAdapter('key', async () => { throw failure; }).search('comic')).rejects.toBe(failure);
    await expect(new ComicVineAdapter('key', async () => ({ status_code: 1, results: { ...issue, site_detail_url: 'https://evil.example/4000-123/' } })).details('4000-123')).rejects.toThrow('invalid issue source link');
  });
});

test('provider descriptions become bounded escaped text with hidden executable content removed', () => {
  expect(readingPlainText('<p>One &amp; two</p><script>bad()</script><style>hide</style><p>&#x41; &#66;</p>')).toBe('One & two A B');
  expect(readingPlainText('&lt;img src=x onerror=bad()&gt;A<!-- hidden -->B')).toBe('A B');
  expect(readingPlainText('A&#99999999;B')).toBe('AB');
});

test('reading presentation carries source attribution and local work actions without screen playback fields', () => {
  const local = { id: crypto.randomUUID(), provider: 'comic-vine' as const, externalId: '4000-123', kind: 'comic' as const, title: 'Comic', authors: ['Writer'], subjects: [], publishedYear: 2001, sourceUrl: issue.site_detail_url };
  const card = readingCard(local);
  expect(card.workId).toBe(local.id);
  expect(card.href).toBe(`/media/${local.id}`);
  expect(card.attribution).toEqual({ label: 'Comic Vine', href: issue.site_detail_url });
  expect(readingHero(local).available).toBe(false);
  const remote = readingCard({ ...local, id: local.externalId }, '/media/comic-vine/4000-123');
  expect(remote.workId).toBeUndefined();
  expect(remote.year).toBe(2001);
  expect(remote.available).toBe(false);
  expect(readingCard({ ...local, title: 'Harley Quinn #66', authors: [], seriesTitle: 'Harley Quinn', issueNumber: '66' }).captionSubtitle).toBeUndefined();
  expect(readingCard({ ...local, title: 'A different story', seriesTitle: 'Harley Quinn', issueNumber: '66' }).captionSubtitle).toBe('Harley Quinn #66');
  expect(readingHero({ ...local, id: local.externalId }, true).href).toBe('/media/comic-vine/4000-123');
});

test('provider pagination never advertises an unsupported next page', async () => {
  const books = new OpenLibraryAdapter(async () => ({ docs: [book], numFound: 20001 }));
  const comics = new ComicVineAdapter('key', async () => ({ status_code: 1, number_of_total_results: 10001, results: [issue] }));
  expect((await books.search('book', READING_PROVIDER_PAGE_LIMIT)).nextPage).toBeNull();
  expect((await comics.search('comic', READING_PROVIDER_PAGE_LIMIT)).nextPage).toBeNull();
  await expect(books.search('book', READING_PROVIDER_PAGE_LIMIT + 1)).rejects.toThrow();
  await expect(comics.search('comic', READING_PROVIDER_PAGE_LIMIT + 1)).rejects.toThrow();
});


test('Open Library discovery uses real ranking and publication sorts in one bounded request', async () => {
  const paths: URL[] = [];
  const adapter = new OpenLibraryAdapter(async path => {
    paths.push(new URL(path, 'https://openlibrary.org'));
    return { docs: [book], numFound: 41 };
  });
  const trending = await adapter.discover('trending', 2);
  expect(trending.nextPage).toBe(3);
  expect(paths[0].searchParams.get('sort')).toBe('trending');
  expect(paths[0].searchParams.get('q')).toBe('trending_z_score:[1 TO *]');
  await adapter.discover('recent');
  expect(paths[1].searchParams.get('sort')).toBe('new');
  expect(paths[1].searchParams.get('q')).toBe(`first_publish_year:[1 TO ${new Date().getUTCFullYear()}]`);
  expect(paths.every(path => path.searchParams.get('fields') !== '*' && path.searchParams.get('limit') === '20')).toBe(true);
  await expect(adapter.discover('recent', 1001)).rejects.toThrow();
  expect(paths).toHaveLength(2);
});

test('Comic Vine discovery uses store dates and never treats recent edits as popularity', async () => {
  let calls = 0;
  const adapter = new ComicVineAdapter('secret-key', async path => {
    calls++;
    const url = new URL(path, 'https://comicvine.gamespot.com');
    expect(url.pathname).toBe('/api/issues/');
    expect(url.searchParams.get('sort')).toBe('store_date:desc');
    expect(url.searchParams.get('filter')).toBe(`store_date:1900-01-01|${new Date().toISOString().slice(0, 10)}`);
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('offset')).toBe('10');
    return { status_code: 1, number_of_total_results: 21, results: [issue] };
  });
  expect((await adapter.discover('recent', 2)).nextPage).toBe(3);
  await expect(adapter.discover('trending')).rejects.toThrow('does not provide a trending feed');
  await expect(adapter.discover('recent', 1001)).rejects.toThrow();
  expect(calls).toBe(1);
});

test('Open Library edition lookup keeps edition/work identity distinct and refuses ambiguous or mismatched records',async()=>{
 const exact=new OpenLibraryAdapter(async path=>{expect(path).toBe('/books/OL456M.json');return {key:'/books/OL456M',works:[{key:'/works/OL123W'}]};});
 expect(await exact.workForEdition('OL456M')).toBe('OL123W');
 expect(await new OpenLibraryAdapter(async()=>({key:'/books/OL456M',works:[{key:'/works/OL123W'},{key:'/works/OL999W'}]})).workForEdition('OL456M')).toBeNull();
 await expect(new OpenLibraryAdapter(async()=>({key:'/books/OL999M',works:[{key:'/works/OL123W'}]})).workForEdition('OL456M')).rejects.toThrow('different edition identity');
 await expect(exact.workForEdition('OL123W')).rejects.toThrow();
});

test('Open Library classifies comics and accepts only dedicated issue cross-references', async () => {
  const adapter = new OpenLibraryAdapter(async path => path.startsWith('/works/') ? {
    key: book.key, title: 'A Series #1', subjects: ['Comic books, strips, etc.'],
    links: [ { title: 'Comic Vine', url: 'https://comicvine.gamespot.com/a-series/4000-123/' },
      { title: 'Related series', url: 'https://comicvine.gamespot.com/a-series/4050-456/' } ],
  } : { docs: [{ ...book, subject: ['Graphic novels'], title: 'A Series #1' }], numFound: 1 });
  expect((await adapter.search('A Series')).items[0].kind).toBe('comic');
  const detail = await adapter.details('OL123W');
  expect(detail.kind).toBe('comic');
  expect(detail.identities).toEqual([{ provider: 'comic-vine', externalId: '4000-123' }]);
  expect(readingCard({ ...detail, id: detail.externalId }).attribution).toBeUndefined();
});

test('Comic Vine resolves matching volumes then bounded issues and preserves named issue results', async () => {
  const paths: URL[] = [];
  const adapter = new ComicVineAdapter('key', async path => {
    const url = new URL(path, 'https://comicvine.gamespot.com'); paths.push(url);
    if (url.searchParams.get('resources') === 'volume') return { status_code: 1, results: [
      { id: 456, name: 'Harley Quinn: The Animated Series', resource_type: 'volume' },
      { id: 789, name: 'Unrelated Series', resource_type: 'volume' },
    ] };
    if (url.pathname === '/api/issues/') {
      expect(url.searchParams.get('filter')).toBe('volume:456');
      expect(url.searchParams.get('limit')).toBe('10');
      return { status_code: 1, results: [{ ...issue, name: 'A story', volume: { id: 456, name: 'Harley Quinn: The Animated Series' } }], number_of_total_results: 21 };
    }
    return { status_code: 1, results: [], number_of_total_results: 0 };
  });
  const result = await adapter.search('Harley Quinn: The Animated');
  expect(result.items.map(item => item.title)).toEqual(['A story']);
  expect(result.nextPage).toBe(2);
  expect(paths).toHaveLength(3);
  await adapter.search('Harley Quinn: The Animated', 2);
  expect(paths[5].searchParams.get('offset')).toBe('10');
  expect(paths).toHaveLength(6);
});

test('a successful empty book search permits one filtered fallback, never retries rate limits', async () => {
  let calls = 0;
  const adapter = new OpenLibraryAdapter(async () => ++calls === 1 ? { docs: [], numFound: 0 }
    : { docs: [{ ...book, title: 'Harley Quinn' }, { ...book, key: 'OL555W', title: 'Harold' }], numFound: 200 });
  const result = await adapter.search('Harly Quinn');
  expect(calls).toBe(2);
  expect(result.items.map(item => item.title)).toEqual(['Harley Quinn']);
  expect(result.nextPage).toBeNull();
  const failing = new OpenLibraryAdapter(async () => { calls++; throw new ProviderHttpError(429, 60); });
  await expect(failing.search('Harly Quinn')).rejects.toMatchObject({ status: 429 });
  expect(calls).toBe(3);
});
