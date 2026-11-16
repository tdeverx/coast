# Provider recommendation rows

## Row coverage

| Medium | Viewer library and catalogue | Remote |
| --- | --- | --- |
| Movies and TV | Accessible titles and genre rows, catalogue exploration and dated upcoming releases, personal taste and related-title rows | TMDB and Trakt combined for comparable trending, popular genre and anticipated lists. TMDB supplies recent and top-rated lists. Linked Seerr supplies Trending when the primary sources can't. |
| Games | Synced Steam ownership, catalogue genres and releases, personal taste and related titles | IGDB trending, recent, popular by genre, top-rated, and upcoming games. |
| Music | Albums and release dates from playable Jellyfin sources, visible listening activity, and personal taste | The connected music sources supply library data. |
| Books and comics | Viewer-accessible titles, catalogue genres and dated releases, personal taste and related works | Open Library trending, recent books and subject browsing. Comic Vine recent and upcoming issues. Existing preview routes handle new provider identities. |

For You selects a bounded number of supported provider genres from local interests and filters known watched, saved, dropped or low-rated results after resolving canonical identities. Shared list requests use public application credentials and closed genre values. Personal Trakt and seed recommendations still come from the account-scoped background import job and its generation checks. Discover does not use history or taste to rank catalogue or provider rows.

Screen results are merged using provider IDs scoped by media kind. Each independent ranking source contributes at most one rank per title. The resolver reuses existing canonical records, skips ambiguous mappings, and ingests missing titles before linking to Coast's normal details. IGDB and reading rows reuse their existing preview paths.

Provider contracts reviewed against [TMDB movie discovery](https://developer.themoviedb.org/reference/discover-movie), [TMDB TV discovery](https://developer.themoviedb.org/reference/discover-tv), [Trakt screen lists](https://trakt.docs.apiary.io/reference/sync), [IGDB filters and sorting](https://api-docs.igdb.com/), and [Open Library search](https://openlibrary.org/dev/docs/api/search).

## Performance and correctness

- The Discover overview reads at most five local hero cards. Both censuses performed zero provider calls in the PostgreSQL fixture. Chromium held an empty provider row and observed one in-flight request, 1,442 px scroll position, and 2,342 px document height. After the empty row settled, those values held. The next row grew the document to 2,710 px while the viewport stayed at 1,442 px.
- Concurrent personal and generic rows shared one TMDB read and one Trakt read. PostgreSQL verified three unique screen results from four candidates, two new metadata records, preservation of the existing title, and two personalized results after local history exclusion. The warm revisit retained equal rows and equal metadata snapshots. Tests also exercised a partial outage, the disabled provider fence, and the last caller aborting a shared read.
- Each provider cache is bounded to 80 metadata pages, 30 minutes, and 12 active misses. It resolves current credentials before cache access. Result pages use one bounded listing per provider and kind. The mixed Trending shelf can read both Trakt kinds. Screen imports run with at most four transactions per row. Remote network work occurs outside database transactions.
- Desktop Chromium opened provider rows in the detail sheet on For You and Discover. Mobile Chromium opened a public Discover provider row in its standalone grid. The browser test used controlled provider responses and local presentation data, with zero page errors.
- The size comparison used a disposable PostgreSQL 17 database with generated, TMDB-identified catalogue titles and a warm guest scope. Seven samples followed one warm-up per operation. Medians in milliseconds were 0.96/3.44 for the hero, 2.03/5.48 for definitions, and 1.61/4.11 for the first page at 500/10,000 titles. Hero, definition and first-page sizes stayed at 5, 25 and 60. The catalogue candidate window grew from 500 to its 1,000-title cap. SQL still inspects eligible catalogue data as the installation grows. These measurements exclude HTTP, live providers and production traffic.

Earlier audit receipts retain their previous source epochs. The [source refresh](source-refresh.json) binds the changed files to this verification.
