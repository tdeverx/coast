# Scoped Activity admission — V1 verified, unadopted

The private V1 candidate moves the existing structural event scope before expensive privacy and enrichment work in the shared `activityFeed` owner. **No production source is adopted.** All 64 available actual-data cases matched in full exported responses and ordered primary SQL rows. The candidate reduces read work in all seven measured work scopes, with a consistent temporary-block cost that a separate private work-ID option will investigate. This remains a partial Activity option; relationship-reason work and remaining query cost persist.

The candidate uses a conditional `MATERIALIZED admitted_activity` containing full event rows. `visible_raw` reads it directly. The exact existing work/artist/reading-group/explicit-ID predicates are reused in both admission and the original WHERE. Unscoped queries stay on the original source; **all 34 unscoped comparisons had byte-identical compiled SQL and parameters**. Direct work/show/season/direct-member semantics, scope AND versus relationship-target UNION, whole-history dedupe/listen/run grouping, privacy, cursor/period/final limit, and visible-event-based relationship fallback remain intact.

The [full actual receipt](evidence/scoped-activity-admission-v1-full.json) contains 42 historical feed contexts, 16 scoped contexts across four actual owners, and six additional actual request shapes: empty/duplicate explicit IDs, artist, artist+work, reading group and group+work. All 64 were distinct literal inputs; none was silently skipped by deduplication. Filter/cursor and empty/duplicate-ID arguments are explicit verification inputs over retained actual rows, not captured natural browser traffic. The two compound scopes returned actual cards. There are positive episode-run and relationship-only fallback cards, unknown-date cursors, returned cursors and reactions. The four-owner empty movie/829-episode season/23-member collection and populated show cases preserve all fields and occurrence order. Actual dated multi-track batches and repeated dated work listens are absent; their behavior is not claimed verified here.

The original [two-case pilot](evidence/scoped-activity-admission-v1-pilot.json) is preserved separately. The full run then captured 16 exact source-shaped plans and four alternating full-owner timing pairs, with complete outputs rechecked in those samples. Both runs used one reserved explicit repeatable-read/read-only backend, verified 30s/1s budgets, `jit=off`, `work_mem=4MB`, exact clone/source guards and denied external fetch. Source pins remained unchanged, both transactions rolled back and both pools/processes closed. No normal database, schema, saved data, credentials or provider transport was changed. Other-client count zero was a preflight observation under coordinated leases.

| Source-shaped plan context | Execution ms before → candidate | Shared Hit Blocks | Shared Read Blocks | Temp Read Blocks | Temp Written Blocks |
| --- | ---: | ---: | ---: | ---: | ---: |
| reaction-activity-ids | 3.3 → 3.0 | 223 → 233 | 10 → 0 | 0 → 0 | 0 → 0 |
| 0:observed-normal-movie | 6221.3 → 1437.0 | 1,341,648 → 553,488 | 3,319 → 1,351 | 2,696 → 3,352 | 4,412 → 5,068 |
| 0:largest-season | 6405.1 → 1357.7 | 1,339,305 → 554,831 | 5,662 → 8 | 5,488 → 6,144 | 4,412 → 5,068 |
| 0:largest-collection | 6296.1 → 1322.4 | 1,362,818 → 574,982 | 2,389 → 97 | 2,696 → 3,352 | 4,412 → 5,068 |
| 0:retained-active-show | 6389.1 → 2721.4 | 1,337,626 → 759,238 | 3,082 → 467 | 4,092 → 4,748 | 4,412 → 5,068 |
| 1:observed-normal-movie | 5537.0 → 1307.1 | 948,265 → 553,838 | 1,639 → 1,001 | 2,696 → 3,352 | 4,412 → 5,068 |
| 2:observed-normal-movie | 1965.0 → 1359.0 | 730,850 → 554,839 | 807 → 0 | 2,696 → 3,352 | 4,412 → 5,068 |
| 3:observed-normal-movie | 6379.3 → 1314.7 | 1,177,521 → 554,542 | 3,081 → 293 | 2,696 → 3,352 | 4,412 → 5,068 |

These are **root-only** counters. No nested counters are summed, and Shared Read Blocks do not prove physical disk traffic. The explicit-ID pair has the same 233 combined shared hits/reads on both sides; its cache split changes, with zero temporary work. Every measured work scope adds 656 temporary reads and writes.

The plans identify the extra work: admission hashes 134,289 episode rows in two batches at the verified 4MB work-memory setting. That admission hash-join subtree reports the same extra 656 temporary blocks; the pilot also shows a 5,547-row single-batch season hash. Even the zero-row movie admission incurs the spill. Therefore the evidence supports an added **admission join spill**, rather than assuming the materialized event output itself caused it. Per-node attribution is retained in the [machine-readable report](next-scoped-activity-admission.json).

The 0:observed-normal-movie full-owner median across only two alternating pairs was 6547 → 1264ms (primary median 6546 → 1263ms).
The 0:retained-active-show full-owner median across only two alternating pairs was 6837 → 2768ms (primary median 6693 → 2671ms).

These local-clone measurements exclude serialization, HTTP and the browser; background/cache conditions are not a production-load model. The selected movie identity was observed in normal UI and exists in the clone, but retained viewers/settings/time differ. This is no normal latency-cause or universal speedup claim.

A separately reviewed source-only alternative can derive a nonrecursive allowed work-ID set: requested work plus direct contains children, episodes whose own show/season is in those original roots, and seasons whose own show is in those roots. An IN/semijoin preserves one event occurrence. That option is still unexecuted and needs its own exact proof and lease. Do not modify the reviewed V1 proof or infer adoption from this report.

[Baseline source](candidates/scoped-activity-admission-v1/queries.before.ts.txt), [exact V1 candidate](candidates/scoped-activity-admission-v1/queries.candidate.ts.txt), [patch](candidates/scoped-activity-admission-v1/scope-admission.patch), [executed probe](candidates/scoped-activity-admission-v1/executed-probe.ts.txt), [reviewed plan](candidates/scoped-activity-admission-v1/reviewed-verification-plan.json), [prior baseline attribution](scoped-activity-attribution.md). These immutable executed sources retain original local path/pin guards; future replay requires explicit reviewed rebinding and a new lease. No common ledger, status or application acceptance is changed by publication.
