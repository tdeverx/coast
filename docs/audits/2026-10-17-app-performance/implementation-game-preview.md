# MIN-01 — bound game preview hydration at its shared owner

Status-filtered Play previews now request12 rich game records from the canonical reader before hydration. Previously they read a60-record page, fetched parent/personal presentation metadata for that page, then returned only its first12 cards. Full-grid/API/search callers retain the default60-record page and existing ranking/paging. No UI, provider, schema, dependency, toast or navigation change is included.

[Machine-readable record](implementation-game-preview.json), [actual complete-output proof](evidence/implementation-game-preview-actual.json), [actual census](evidence/implementation-game-preview-census.json), [focused guards](evidence/implementation-game-preview-tests.json).

## Shared contract and consumers

The optional fourth argument to [listGames](../../../src/lib/core/games/service.server.ts:43) is an integer projection cap from1 through60. A smaller cap is allowed only for the first unsearched page. This prevents a caller from changing the client search reranking candidate set or interpreting12 as a new page size. `PAGE_SIZE=60` still owns totals/pages, clamping and offsets; public requests do not gain a projection parameter. Invalid bounds, a reduced nonempty search and a reduced later-page request fail before database reads.

[Status preview](../../../src/lib/server/queries/media-rows.ts:92) passes the existing12-card size and maps the returned records directly. The ordinary game preview also uses that same local constant in place of its existing12 literal; its recent-created/personal-recent sort is unchanged. The shared list still applies feature/privacy filters, latest owner playthrough status, Steam availability, SQL title/id ordering, verified parent presentation and viewer-owned preferences. Empty-query `rankSearch` preserves admission order, including when displayed titles have preferences.

| Consumer | Limit and retained behavior |
| --- | --- |
|Home/Library status-filtered Play preview through `libraryContent`|12 before game/presentation hydration; exact existing card identities, title/year/art, edition identity, availability caption and failure/page/total contract.|
|Unfiltered all-state Play preview|Existing12 and existing created/recent-personal sort, with its original presentation path.|
|Library Play grid and `/games` library grid|Default60; page2 offset60, existing clamping/pages/totals and metadata.|
|Games API and local game search|Default60; no request/API argument added, search ranking candidate set unchanged.|

The count query is retained, including its status predicates. The nonempty measured paths still execute four ORM statements. This change bounds rich result admission and metadata work; it does not remove count/feature/policy work or introduce a cache or new query framework.

## Actual-data proof and its limits

The existing private actual-data fix clone contains1,218 games,122 verified variant relations, one playthrough and four enabled game owners. Only the dropped status has a persisted item; all other current-status cohorts are empty. There are no actual game presentation preferences, no variant in the title-sorted first12, and the sole playthrough is not a variant. No catalogue, playthrough, preference or settings row was invented or changed.

The [source-pinned probe](probes/game-preview-actual.ts) compared captured pre-edit modules with current modules using shared current dependencies in one reserved, repeatable-read **READ ONLY** transaction. It verified30s statement/5s lock limits and disabled JIT explicitly, then rolled back and closed the pool. Both the original game reader and current preview source were retained before edits; the former matches audited HEAD, while the latter includes earlier accepted cancellation work. The [baseline snapshots](candidates/game-preview/service.before.ts.txt) and [preview snapshot](candidates/game-preview/media-rows.before.ts.txt) preserve those exact bytes. No normal/deployed database was touched.

All332 complete logical DTO comparisons passed:

- 96 default full-grid reads across real owners, all/five status filters, personal flags and availability flags.
- 96 bounded-head reads equal to the baseline's first12 rich records, preserving full totals/page metadata.
- 96 complete Library preview responses, including all-state recent-order paths, owner/status/availability selection, cards and wrapper pagination.
- 32 page2/last-page-clamp comparisons, retaining the60-row stride.
- 12 full ranked-search comparisons from actual catalogue titles, including a verified variant title. These verify unchanged default presentation/ranking; they do not create a positive reduced-head inheritance cohort.

Five alternating generic catalogue full/head pairs admitted60→12 rich game records and65→13 returned ORM rows, with four ORM statements in both cases. Their median complete-call times were2.40ms and1.60ms on this quiet clone. ORM counts cover prepared-query execute results; raw BunSQL/config reads and PostgreSQL internal work are excluded. These generic head samples demonstrate the available admission reduction, **not an observed busy status-preview speedup**. The actual changed status consumer currently admits1→1 or0→0 rows. No browser, heap/RSS, CPU, concurrency or large-data latency benefit is claimed.

Positive reduced-head parent-inheritance/private-alias coverage is unavailable in this actual snapshot. The122 real variants and selected variant search cover existing default-full paths, and the shared mapping code is unchanged. Revalidate the head path when naturally persisted matching statuses/variants/preferences become available; do not manufacture them to claim a measured gain.

The [focused test](../../../tests/games-preview-projection.test.ts:1) passed2 tests/8 assertions for invalid caps and unsafe search/later-page use without a database. Full-grid default success and complete head/preview equivalence are established by the actual-data probe. Whole-application gates and browser acceptance belong to root's coordinated run, not this focused receipt.

## Maintenance and remaining options

Keep the new cap at the shared game reader and the preview size at its existing consumer owner. Any future use of a smaller cap must remain a first-page, empty-query projection; a genuine configurable page size or searched preview needs a separately reviewed ranking/pagination contract. The current small argument change avoids that rework.

The retained probes are exact executed audit artifacts for this checkout and approved private runner. They validate clone guards and pin pre-edit modules; retained baseline files contain source only. A future replay must restore those source snapshots to the probe's expected private paths or review a path-only adaptation, bind the appropriate checkout/dependencies and use an approved actual-data clone. Keep outputs aggregate-only and preserve missing-cohort disclosures.

A later count-free head reader could remove a query that previews do not consume, but that is a separate return-contract change and is not needed for this bounded admission fix. Relevance, metadata inheritance, private titles and ownership are preserved through the existing owners. Navigation and toast approvals remain pending and are unaffected.

Independent read-only review approved the exact current game-owner hash `e6e01eac392126a5c06fdaf246fc139b7cfa57e7d01e59845d502386894bf52d` and preview-owner hash `0e7f387f6f7cf7d57949b9eec74dfafe997c170caac03ef9531c465deb0a975e`, with no material issue. The earlier cancellation edits were preserved. Owned source, test and documentation writes are frozen after this review.


## Current applied-source browser acceptance

The [2026-10-18 signed-in normal-dev trial](evidence/implementation-owner-batch-normal.json) reloaded the current source after the build, with audit-owned repository writes frozen. The actual dropped-game preview, movie and episode menus, profile overview/favourites panel, Admin health and 30 task rows rendered. This trial recorded zero new console warnings/errors and no framework overlay. It did not exercise real filter/preference writes, active device authorization, chunk failure, natural cancellation schedules or performance/resource limits. Historical HMR errors before the reload and the earlier unresolved route observations remain separate.
