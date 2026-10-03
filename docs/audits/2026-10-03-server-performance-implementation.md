# Server performance implementation report

Date: 3 October 2026. Runtime: repository Bun 1.4.2 on macOS ARM64. Main checkout branch `codex/performance-benchmarks`, baseline HEAD `c771fb9`. No production dependencies, commits, pushes, deployments, live-provider requests, or real-user database writes were performed.

## Owned source and tests

- `src/lib/sync/trakt-import.ts`
- new `src/lib/sync/trakt-history.ts`
- `src/lib/catalogue/maintenance.server.ts`
- `src/lib/server/storage/image-cache.server.ts` (delegated child, reviewed)
- new `tests/trakt-history.test.ts`
- new `tests/trakt-history-db.test.ts`
- new `tests/catalogue-roots-db.test.ts`
- `tests/catalogue-maintenance.test.ts`
- `tests/image-cache.test.ts` (delegated child, reviewed)

Jellyfin final observation paging, provider-cache expiry, and the getTmdb provider tag are lead-owned changes and were preserved. There are no edits here to queue, schema/migrations, Settings, Collection, lifecycle, or revisions. Trakt adapter and getTmdb/service ingestion were left unchanged.

## Trakt retained history

History retains compact records containing the source ID, all timestamp fallback fields, and the movie/show/season/episode fields consumed by resolveTrakt. Unused page metadata, type, year and slug are omitted. A temporary table interns matching title metadata by kind and Trakt ID. Different consumed metadata retains its own event-specific object. The table clears at 10,000 distinct identities and after traversal, avoiding growing interning overhead; existing retained event objects remain valid.

The existing oldest-first watched_at locale comparator and stable sort are unchanged. Complete traversal still precedes all history application. Same-date records remain in source input order across pages. Source-event ID construction, fallback timestamp selection, removed-source suppression, local conflict policy, retry idempotence, and leaf/show identity resolution are unchanged. Current independent experimentalMusic/Gaming/Parties controls are untouched.

Three alternating before/after runs per fixture used the real Trakt adapter and real compact helper, with synthetic transport only. Heap values are additional retained heap after GC; they are not production account sizes or process memory limits. Full ordered SHA-256 digests of every consumed field matched across all repeats.

| Events / distinct titles | Baseline heap MiB | Compact heap MiB | Baseline parse/stage ms | Compact parse/stage ms | Baseline sort ms | Compact sort ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 / 10,000 | 3.570 | 3.300 | 9.518 | 14.667 | 0.779 | 1.040 |
| 100,000 / 100,000 | 34.465 | 31.445 | 66.275 | 108.028 | 3.769 | 6.412 |
| 100,000 / 1,000 | 32.524 | 11.366 | 58.184 | 116.438 | 3.432 | 5.962 |

This is a memory/CPU tradeoff. Unique-title histories improve retained heap modestly; repeated titles improve substantially. Compact staging adds tens of milliseconds of local CPU at 100k events. The complete history array is still retained: this change is not a strict bound on total import heap. The existing 10,000-page guard remains. Strict chronological staging would require ordered storage or a proven provider ordering contract; no page-order streaming was introduced.

Artifacts: `/tmp/coast-trakt-history-bench.ts`, `/tmp/coast-trakt-history-bench-results.json`. An initial trial evicting one interned Map key at a time exhibited large Map-iterator churn with unique titles and was replaced by the measured bounded-table clearing approach. The final table above contains only the final implementation.

## Resolved Jellyfin catalogue roots

The scanner collects distinct active root IDs per library page, batch-checks provider_items joined to canonical TMDB external IDs for the same instance and matching movie/show kind, then downloads only unresolved roots. Episodes still resolve via their parent show. The verified-reference save path and its concurrent identity handling remain authoritative for new roots. This is metadata discovery only and creates no personal relationship/access.

A real scanner/adapter controlled synthetic fixture had 1,000 roots, 950 already resolved, 10 pages. Three before/after runs matched all 50 newly added identities exactly. Baseline performed 1,000 root reads and 1,000 save checks; repaired performed 50 root reads and 50 save checks plus 10 batched identity checks. Both performed 10 library reads. Median fake-transport elapsed time was 9.884 -> 7.424 ms. The robust result is avoided request/check counts; these timings exclude remote network and actual database lookup latency and do not predict live scan duration.

Known roots are determined from existing instance-specific provider mappings, not an unscoped remote ID. Unresolved roots, roots known only in another instance, and media-kind mismatches still require reads. Existing mapping freshness/identity policy is retained; this optimization intentionally does not re-download already resolved root metadata during account discovery. Shared refresh remains responsible for full metadata. No unmeasured unchanged-episode/write-skip hypothesis was implemented.

Artifacts: `/tmp/coast-catalogue-root-bench.ts`, `/tmp/coast-catalogue-root-bench-results.json`, `/tmp/coast-catalogue-maintenance-baseline.ts` (baseline HEAD imports rewritten to local dependencies only).

## Image cache

A byte total changes on restored entries, successful writes, changed-size reads, ENOENT reads, and eviction. Trim returns before materializing/sorting entries when byte and file-count budgets already admit the allocation. Serial admission, free-space checks, temp-file cleanup and LRU/restored budgets are preserved.

The harness extracts actual baseline/current trim bodies. Seven alternating rounds x 200 calls over 10,000 entries after warmup yielded median 1.012841 -> 0.000147 ms per call. This is the Map scan/allocation/sort versus early return only, without filesystem I/O or a live latency claim. Six image-cache tests cover restored budgets/LRU, count limits, concurrent duplicate admission, oversized rejection, changed sizes, external deletion/restoration, cleanup and free-space rejection. All OS-temporary directory fixtures are removed in finally blocks.

Artifacts: `/tmp/coast-image-cache-implementation-report.md`, `/tmp/coast-image-cache-benchmark.ts`, `/tmp/coast-image-cache-benchmark-results.json`.

## Verification status

- Focused non-DB suite: 13 tests passed, 71 assertions across image-cache, catalogue-maintenance and Trakt-history.
- Integrated installed svelte-check CLI: 0 errors and 0 warnings. Log `/tmp/coast-server-svelte-check.log`.
- Scoped `git diff --check` passed.
- Final isolated DB run against corrected migration 0039: all four suites passed, including cleanup: **10 tests / 58 assertions**. Log `/tmp/coast-server-db-tests.log`. Each suite received its own migrated disposable database and temporary data directory; all were dropped/removed by the test runner.
- The original HEAD Trakt import also passed the identical history regression assertions in an additional disposable database: **1 test / 9 assertions**. Its fixtures and data directory were removed. Log `/tmp/coast-trakt-history-baseline-db.log`; harness `/tmp/coast-trakt-history-baseline-db-run.ts`. Baseline and repaired behavior both satisfy the exact expected source-event sequence, event dates/rewatch flags, watched state/count, suppressed event absence, no writes after interrupted traversal, and retry state.
- Passing DB suites: new root identity fixture (1 test/3 assertions), new 106-record history fixture (1 test/9 assertions: interrupted second page applies nothing, equal-date cross-page order, source IDs, fallback timestamp, suppression, oldest-first rewatches, state and retries), existing Trakt-sync fixture (3 tests/19 assertions), existing catalogue-maintenance fixture (5 tests/27 assertions).
- Initial integration testing exposed a lead-owned metadata_overrides content-revision trigger cleanup bug. It was reported and corrected by the lead, then all suites were rerun green. Initial failure evidence remains in `/tmp/coast-server-db-tests-initial.log`; it is not counted as a final passing check.

The PostgreSQL admin URL was read from `/tmp/coast-social-dev-runtime.json` without credential output, and used only to create/drop new test databases. The existing dev database and 5173 server were not modified. Benchmarks use fake transports; no provider writes or real-user fixtures were used. Existing live credentials and runtime files are preserved.
