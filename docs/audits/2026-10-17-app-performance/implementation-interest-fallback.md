# Shared interest-root fallback admission

The canonical interest query now skips album-parent resolution when an episode or season already has a show root. This is an actual-data-verified input-query improvement shared by **PLAN-03, PLAN-04 and PLAN-05** and provider recommendation seed selection. It does not resolve their broader freshness, scoring, feed-adjacency or provider-work concerns.

## Exact shared change and consumers

Only [interestWorks](/Users/admin/Documents/ChatGPT/coast-new/src/lib/recommendations/interests.server.ts:20) changes: its existing album lateral gains `e.show_id is null and s.show_id is null` inside the WHERE clause. Its output is otherwise consumed only after those two show values in `coalesce(e.show_id,s.show_id,r.parent_id,p.id)`. A non-null show root therefore makes the album lookup irrelevant. The LEFT JOIN can return no album row without changing the chosen root or any signal field.

The album-kind join, `contains` relationship, `position,parent_id` order and limit 1 stay unchanged. No predicate moves before signal admission or root collapse. Personal negative-min versus global maximum weighting, boolean folds, most-recent timestamp, 300-root order/cap, final metadata joins, category/feature gates and complete `InterestWork` DTO shape remain unchanged. `interestPolicyRevision` is byte-for-byte unchanged.

| Runtime consumer | Scope and use | What this change preserves |
| --- | --- | --- |
| `refreshTasteCaches` — PLAN-03 | Personal evidence before feature/profile construction | Existing ten-user checkpoint, per-user revision snapshot/recheck and lease, scoring and 500 candidates per medium |
| `recommendationRows` — PLAN-04 | Personal category evidence and first 100 positive roots | All recently repaired genre scoring, 2,000-candidate preselection, negatives, titles, ties and page hydration |
| `dynamicFeed` — PLAN-05 | Personal immutable definition census per visit | Genre recency/weight folds, seed definitions, rank/tie order, feature admission, up to four bounded adjacency reads and 10,000-definition guard |
| `refreshProviderRecommendations` | Global/null-user interests for TMDB/IGDB seed selection | Global maximum weighting, enabled category filters, existing seed sort, freshness admission, six-seed checkpoint and publication fences; Trakt uses its existing independent fixed seed kinds |

The For You row/grid API and lazy shelves benefit through their existing shared consumers; no route-specific patch or cache was added. Provider jobs were not executed. Source dependencies include the seven signal families (tracking, reading progress, ratings, latest game playthroughs, music progress/listens and work reactions), feature/category SQL predicates, `works`, episode/season ancestry, album relationships and the four metadata owners. Only the previously unused album lookup's admission changes.

The exact [baseline](candidates/recommendations/interests-before.ts.txt) and [executed private candidate](candidates/recommendations/interests-candidate.ts.txt) are retained. Production source matches the reviewed candidate SHA256 `ebc4a4050d98eb00c884dc40db2b46aa57d73a6666130f04f54b4d712d51e79e`.

## Actual complete outcomes and positive fallback census

The [initial private-candidate census](evidence/implementation-interest-fallback-before.json) and [final adopted-source proof](evidence/implementation-interest-fallback-actual.json) each compare the complete ordered production query result for all four saved enabled users and `null`/global scope. No sorting, field stripping or sampled subset masks output differences. They preserve **1,018 returned object observations across five contexts**, including identity, kind/category, title, genres, weight, consumed/positive flags and timestamp. These observations overlap across users and global scope; they are not 1,018 unique works.

| Scope | Returned objects | Positive / negative |
| --- | ---: | ---: |
| Personal owner 0 | 29 | 28 / 1 |
| Personal owner 1 | 298 | 298 / 0 |
| Personal owner 2 | 103 | 103 / 0 |
| Personal owner 3 | 300 | 300 / 0 |
| Global/null | 288 | 288 / 0 |

The canonical global roots census contains **20,336 admitted signals**. Of these, **19,164 already resolve through show ancestry**, while **1,172 still need the existing fallback path**. Six actual signals resolve through album parents. Every actual album result and its metadata survives unchanged. The largest personal owner contributes 11,650 admitted signals: 11,011 show-rooted and 639 fallback-eligible. All four personal owners have actual show-rooted signals; this is not a fabricated episode-heavy workload.

Both phases use explicit **READ ONLY, repeatable-read** transactions on the approved private actual-data clone, verifying 10-second statement and 1-second lock limits and setting JIT off locally. The standalone function is compiled from the exact source and receives the real transaction query owner; no feature/config stub, provider call, key read, domain fixture, normal/deployed DB access or write is involved. Pools close after each phase. The source and consumer dependency pins stay unchanged during each proof.

## Source-shaped plan evidence

The [plan receipt](evidence/implementation-interest-fallback-plans.json) explains the complete original and exact private-candidate function query for the largest personal owner and global scope. Both ordered complete outputs also match in this phase. Retained plans include structural node/loop/buffer metrics only; all expression fields, bound identities and private payloads are omitted.

| Full query plan metric | Personal baseline | Personal candidate | Global baseline | Global candidate |
| --- | ---: | ---: | ---: | ---: |
| Album relationship scan loops | 11,650 | 639 | 20,336 | 1,172 |
| Shared buffer hits | 552,623 | 134,205 | 989,795 | 261,563 |
| Shared blocks read | 0 | 0 | 0 | 0 |
| Temporary blocks read / written | 439 / 439 | 439 / 439 | 476 / 476 | 476 / 476 |
| Single EXPLAIN execution | 1,089.185 ms | 298.774 ms | 1,948.317 ms | 515.226 ms |

The inner relationship scan removes about 4,051 nonmatching rows per admitted lookup on this corpus. PostgreSQL's new admission node avoids that scan for the already show-rooted signals; it still checks the two null conditions for each row. Full-history signal aggregation and its temporary I/O remain. These are two ordered, warmed, isolated plan pairs, not randomized distributions, concurrent production load, CPU/RSS measurements or browser/provider latency claims. Smaller personal outputs were compared completely but not separately timed. Pure non-screen workloads may gain little and still pay the two inexpensive null tests.

## Supplemental semantics and gaps

The [guarded source-derived regression](/Users/admin/Documents/ChatGPT/coast-new/tests/interest-root-fallback-db.test.ts:10) runs only tableless SELECTs under verified read-only limits. Seven authored ancestry cases use text identity labels to protect episode/season/both-root precedence, album position/parent-ID tie order, non-album exclusion and own-root fallback. Two additional source-derived recent folds protect global maximum versus personal negative-min weighting and boolean aggregation when the same root has opposite signs. **One test / four aggregate assertions passed** in the [control receipt](evidence/implementation-interest-fallback-controls.json). Ordinary discovery without `COAST_DB_TEST=1` parses with one guarded skip.

These controls are supplemental functional evidence, not actual media, UUID-format ordering or performance cohorts. The actual corpus has **zero mixed-sign roots**. A natural multiple-album-parent or tied-position positive cohort was not established. Actual results include movies, shows, albums, one game and one comic; no positive book or large game/reading interest workload is claimed. All four measured owners are enabled. Consent withdrawal, disabled-user, metadata mutation and concurrent update schedules were not rerun; their existing SQL gates and source behavior remain unchanged.

Only shared interest-input preparation is repaired. PLAN-03's staleness census, broad profile/candidate preparation and ranking remain open; its previously rejected global-scalar hoist remains rejected. PLAN-05's genre fan-out, adjacency reads, definition growth and end-to-end feed cost remain open. No complete feed, refreshed taste profile or remote provider seed batch was produced by this proof. The earlier recommendation score receipt retains its historical interest-source pin; this new five-context complete-input equality bridges the changed dependency without pretending to have rerun all 9,543 recommendation scores or their endpoint/browser delivery.

## Maintenance

Keep this admission inside the canonical album fallback so every personal/global consumer benefits. Preserve show-root COALESCE order, album kind/relationship/ties, both weighting modes and the 300-root boundary. Re-run complete ordered actual personal/global outputs and source-shaped relationship scan/buffer plans after ancestry or query changes. Add natural multiple-parent, opposite-sign and additional-medium cohorts when they exist; do not invent them as performance acceptance.

The [machine report](implementation-interest-fallback.json), [final census probe](probes/interest-root-fallback-census.ts), [plan probe](probes/interest-root-fallback-plans.ts) and [control runner](probes/interest-root-fallback-controls.ts) retain reproducibility and source guards. Root owns the shared ledger, common gates and any later acceptance. No cache, schema, dependency, production deadline, retention policy, source freshness or model-quality choice was introduced.

Root combined acceptance: [787passed/708guardedskip/0fail, clean check/build/inventories](evidence/implementation-verification.json) and the [frozen signed-in normal5173 trial](evidence/implementation-shared-admission-normal.json) passed. Actual Continue/Next, friend taste/overlap, Library/music detail/settled Back, Admin and30Tasks rendered without new warnings/errors or source drift. No live recommendation job or admitted Planning creation is inferred.
