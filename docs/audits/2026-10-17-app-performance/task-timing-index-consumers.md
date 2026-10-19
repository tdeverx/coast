# PJ-10: timing-reader index coverage, private result only

**All 37 ordered provider timing rows and the complete taste-job response match with and without I1.** Ordered raw last runs and complete multisets of all eleven emitted read results also match. The proposed terminal-order index lowers the `jobTimings` terminal-display query's root shared visits **5,323→2,496**; the other four measured read families keep their existing root visits and do not admit I1. This adds actual reader evidence to the private Tasks candidate. No production query, index, schema, schedule, retention policy or provider behavior is adopted; PJ-10 remains open.

The [actual immutable receipt](evidence/task-timing-index-consumers-actual.json) contains the full sanitized plans, same-snapshot output hashes, tie census and restoration result. The [exact executed probe](probes/task-timing-index-consumers.ts), [original approved plan](candidates/task-timing-index-consumers/plan.json), [parse-only receipt](evidence/task-timing-index-consumers-syntax.json), [31-file source coverage](evidence/task-timing-index-consumers-source-coverage.json) and [machine report/artifact pins](task-timing-index-consumers.json) preserve the boundaries. The earlier [Tasks four-cell result](task-history-index-matrix.md), [Q1](task-history-q1-current-index.md), [Q1b](task-history-q1b-current-index.md) and their raw receipts/SQL are unchanged. Their statements about untested timing readers describe their earlier experiment; this report adds the specific coverage below.

## What was compared

The unchanged exported `jobTimings()` and `tasteJob()` run once each in I0, then once each after one transaction-local creation of the [same retained I1 index](candidates/task-history-next/index.sql). All seven existing outbox indexes remain. No four-cell Tasks rerun, queue claim, retry, worker, scheduler or provider operation occurs.

`jobTimings` retains actual configuration, provider instances, connected/non-disabled accounts, live/checkpoint/conflict evidence, maintenance completion/latest-state/active evidence, TMDB metadata freshness and terminal display. The display queries every retained connection × current service-task kind, keeps NULL/current generation, selects succeeded/failed/cancelled by `updated_at DESC,id DESC`, and merges per instance/kind. Its local branch retains exactly the four current TMDB/IGDB kinds, NULL connection and payload instance identity. It does not acquire new status, eligibility or scope restrictions. All 37 returned rows, their order, reasons, eligibility/freshness/review counts, completed/next/last timestamps, developer-mode handling and last-run state/outcome/error match. There are 18 non-null displayed last runs and 12 positive completion timestamps.

`tasteJob` retains its current saved schedule validation/defaults, global succeeded completion/outcome, terminal last run and active blocker. Personalisation, developer mode, enabled schedule and deferred/checked-batch interval rules remain unchanged. Both its complete schedule and timing object match, with actual positive completion and last-run history. `scheduleTasteRefresh`, `runTasteRefresh` and cache refresh are not invoked.

There are eleven standalone emitted read results per phase, including two actual configuration reads. This is a complete comparison of these two exported owners, **not** an HTTP Jobs-loader/config-sharing or whole-route comparison. A private transaction-bound `getSql` capture passes all statements to the reserved connection, retains native array binding and rejects unexpected/duplicate/missing statement shapes. Complete ordered public owners and ordered raw lastRuns are compared without field removal or output sorting; raw queries without SQL order additionally use complete row-multiset hashes. Only private-process `Date.now` is held fixed between phases; real Date constructors remain unchanged and SQL NOW shares one transaction clock. Changing live clocks/commits remain outside this proof.

## Five paired plans

| Exact current emitted SELECT | Root shared visits I0→I1 | I1 admitted | One EXPLAIN elapsed I0→I1 |
| --- | ---: | :---: | ---: |
| `jobTimings` maintenance evidence |5,482→5,482|No|19.113→20.087ms|
| `jobTimings` terminal lastRuns |5,323→2,496|Yes|8.935→2.322ms|
| `tasteJob` succeeded completion/outcome |669→669|No|1.066→1.134ms|
| `tasteJob` terminal lastRun |669→669|No|0.981→1.041ms|
| `tasteJob` active existence |1→1|No|0.008→0.008ms|

All these observed shared visits are hits: shared-read and temporary read/write blocks are zero in both phases. These are **one descriptive plan per family per phase** after prior reads, not alternating index-latency samples, a statistical regression distribution or natural CPU/throughput evidence. Small elapsed changes with identical work do not establish an adverse performance regression. MetadataDue and all configuration/account reads are compared as full-owner outcomes; no metadata-query gain is attributed to I1.

The terminal query has a useful **branch tradeoff**, not universal improvement:

- The connected branch drops **3,831→976** shared hits. Its 315 repeated bitmap/sort lookups become ordered normal **Index Scans** on I1. The final outer sort still receives 33 raw representatives; not every retained connection/kind becomes a visible timing card.
- The local NULL/payload-instance branch rises **1,492→1,520** shared hits, an adverse **28-hit** choice. It retains the bitmap-heap/sort structure, with the bitmap index changing from maintenance to I1 and index hits **168→196**. Its residual payload/provider filtering remains. This small added branch work is retained alongside the larger connected benefit.
- The plan's approximate outbox scan returned-row×loop sum drops **25,326→2,016**. Per-loop row counts are rounded EXPLAIN averages; these are not exact visited-row, CPU, transfer or allocation counts. Approximate sort output-row×loop stays 33, and the largest individual reported sort remains 28KiB. The reported sort-space×loop sum **8,603→728KiB is not peak or allocated memory**.

I1 does not INCLUDE `state`, payload outcome or last error. The observed normal Index Scan and Bitmap Heap Scan require heap data. A zero `Heap Fetches` sum for this query means no reported index-only-node fetch counter; **it does not mean zero heap access**. Succeeded-only readers keep the existing succeeded-generation index available. The four unchanged whole-family plans show no observed additional root-buffer work here, not universal immunity for every future/custom/generic plan.

## Actual cohort and timestamp tie boundary

The same actual snapshot has **25,891 terminal actions**, 2,054 NULL connections/NULL generations, zero pending/running/failed, zero dangling connections and zero obsolete generations. All seven retained provider instances are represented in the aggregate readiness census. No users, jobs, outcomes, services, credentials, states or provider responses are invented. Empty active behavior matches, but positive busy/failed/generation cases remain absent.

The new source-shaped aggregate census checks the exact completion scopes:

| Saved completion cohort | Positive scopes | Top timestamp ties | Differing top outcomes |
| --- | ---: | ---: | ---: |
| Connected maintenance evidence |22 of 35|0|0|
| Local TMDB/IGDB payload-instance evidence |2 of 3|0|0|
| Global succeeded `taste.refresh` |1 top row|0|0 (one distinct outcome)|

The local completion scope deliberately retains the current lack of a connection-NULL filter; it is not silently narrowed to match terminal-display SQL. Missing and JSON-null outcomes are grouped according to the same decoded-null behavior; no payload values, IDs or timestamps are published.

**Taste latest-success selection is still underspecified for a future same-time cohort.** `tasteJob` and the scheduler's existing due read order succeeded rows by timestamp only while consuming outcome; different outcomes at that maximum timestamp could select a different interval after a planner change. The current saved maximum has exactly one row/one outcome, so this test cannot establish tie behavior for differing outcomes. No SQL tiebreak, scheduler behavior or fabricated tie cohort was introduced. Other completion scalar reads consume only that timestamp, so equal maximum timestamps do not themselves change their value. Terminal lastRuns already has the UUID tiebreak.

## Isolation and restoration

The parent approved the same smaller transaction-local index method used by the Tasks matrix: initial read-only snapshot, one exclusive **write-capable REPEATABLE READ** transaction for I0/CREATE/I1 and deliberate rollback, then final read-only snapshot. This is private DDL, **not a READ ONLY experiment**. No database is copied, created, dropped, recovered or overwritten. Ordinary CREATE INDEX takes a SHARE table lock and is used only on the explicitly designated disposable clone.

The probe verifies the exact private clone name/loopback endpoint, 15 source hashes, retained SQL and immutable previous receipts, PG17.11, exact seven valid/ready/live outbox indexes, 15 column types/nullability and PK, expected actual history, candidate absence, immediate validated/nondeferrable FK actions/columns, all four enabled immediate RI triggers and origin replication role. Every reserved transaction explicitly sets and verifies repeatable read, 30s statement timeout, 1s lock timeout, jit off and 4MiB work_mem on the same backend. Thirty seconds accommodates full metadata reads and 102-table snapshots, not a product deadline. The no-other-client check is a coordination observation, not a lock against a future connection.

The only new DDL is the exact pinned index CREATE. There is no domain DML, forced scan setting, ANALYZE, VACUUM, old-index drop, normal migration or external fetch. Index relation size is **2,433,024 bytes** and client-observed build time is **23.753ms**, one warmed private observation rather than a scale forecast.

Rollback completes; **all 102 table logical row multisets /1,864,145 rows, sequences and checked schema/catalog/index definitions match**, the audit index is absent, the physical backend matches, the pool closes and forbidden fetch count is zero. Source and prior artifact hashes remain unchanged. Logical/catalog restoration does not erase WAL, cache warming, page effects, I/O history or cumulative statistics; none is claimed restored.

## Other readers, writes and next options

The [source coverage](evidence/task-timing-index-consumers-source-coverage.json) pins all **31 current runtime/schema files** matching the outbox table names. Beyond these measured owners, potential eligible subqueries include maintenance generation-split succeeded timestamps, recommendation succeeded maxima, queue bootstrap completion existence, Jellyfin completed/failed checks and notification terminal-subset visibility. Their enclosing scheduling/control/companion owners can write or call providers and were not invoked. Source predicate classification is not a measured all-reader guarantee; parameterized/custom/generic plans and different data can change admission. Unfiltered latest, active-only and state-not-running families have different predicate coverage, sometimes with eligible nested subqueries.

Independent source review identified concrete remaining writer obligations:

- [Queue completion](../../../src/lib/server/queue/index.ts) at339, failure405, cancel627 and retry660 change terminal membership or recency. A new terminal entry/rekey/removal adds B-tree/predicate work. Existing active/generation indexes at700–705 in schema remain; they are not dropped to offset I1.
- [Connection FK SET NULL](../../../src/lib/server/db/schema.ts) at682 moves I1's leading key; user cascade deletes remove entries. Account/source/feature cancellation adds terminal maintenance and can cascade into staging cleanup.
- Actual SQL includes the [generation insertion pin](../../../drizzle/0016_collection_and_music.sql), [Trakt state-update cleanup](../../../drizzle/0045_trakt_import_staging.sql) and [provider-snapshot state-update cleanup](../../../drizzle/0046_provider_job_snapshots.sql). Any future write proof must preflight actual triggers/functions/RLS rather than assume TypeScript is the entire call graph.

I1 uses column names already present in the PK/maintenance/succeeded indexes or their predicates. **No new HOT-disqualifying attribute is obvious from source**, but this neither measures HOT rates nor makes an extra B-tree free. A normal checkpoint also changes already-indexed updated_at; natural heartbeat/checkpoint/failed transitions have no positive saved state cohort here.

The [original private plan](candidates/task-timing-index-consumers/plan.json) separates two future options. The smallest bounded control would vary only reviewed recency metadata on a few **existing terminal actual rows**, preserving state/payload, under savepoints and complete side-effect/restoration checks; this can describe maintenance cost but cannot prove normal completion or HOT throughput. Matched fresh disposable actual-data clones provide cleaner physical starting points for I0/I1 write/WAL/HOT comparisons, with additional copy/drop lifecycle and remaining cache/page-space limits. Neither option ran. Inventing running/failed jobs or provider payloads to fill the missing cohort is excluded.

This result supports a private read candidate only. Storage growth, write amplification/HOT, other reader families, busy/failed/tie/visibility cohorts, deployment-scale behavior and normal migration/provenance remain open. The earlier query-only Q1b work penalty and Q0-with-I1 non-admission still stand; no coordinated Tasks query/index rollout is implied. Independent read-only draft review found no material ownership/restoration blocker and explicitly raised the retained taste tie issue; it did not execute tests or DB work. No app source/test/build bytes changed by this publication. Root owns shared status and any later rollout decision.
