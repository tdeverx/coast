# Activity relationship-reason materialization — private actual pilot

A one-keyword candidate reduced whole-plan shared-buffer visits for two actual scoped Activity requests while preserving both complete exported DTOs and ordered primary-query rows. The candidate is **unadopted**. It changes only the `reasons` CTE inside `activityRelationships` from ordinary to `MATERIALIZED`; the adopted Activity work-scope query is identical on both sides.

| Actual scope, existing owner 0 | Complete result | Root shared hits + reads, before→candidate | Temp reads / writes, before and candidate |
| --- | --- | --- | --- |
| Existing selected movie | Empty, identical | 525,477→6,085 | 2,696 / 4,412 |
| Existing active show, 3,424 raw events | 28 items / 27 events / 1 relationship-only card, identical | 744,057→224,987 | 4,092 / 4,412 |

The [actual receipt](evidence/activity-reasons-pilot-actual.json) retains all four sanitized source-shaped plans, SQL-shape hashes, parameter counts, complete-output equality flags, resource totals and cleanup. Shared hits and reads are whole-plan root counters; nested node counters are never added to them. These are local logical buffer visits, not physical disk bytes, function-call counts or CPU measurements. Each side has one descriptive EXPLAIN execution per scope, with **zero timing sample series**. No normal-browser speedup or production latency gain is claimed.

The candidate introduces a once-executed `CTE reasons` producer (`Unique` over `Sort`) and a `CTE Scan`, materializing zero movie reasons and 52 show reasons. Its producer sort is a small in-memory quicksort in this pilot (25/28 KiB). Both variants still scan 90,971 tracking rows; the collected branch retains 1,141 and rejects 89,830. The first tracking scan's attributed shared hits change from 509,204 to 1,264, consistent with separating expensive outer policy filtering from scoped reason production. Sanitized plans do not count policy-function invocations, so that remains a structural interpretation. Existing recursive edge work and all root temporary counters remain unchanged.

## Scope and safeguards

The exact [plan](candidates/activity-reasons-pilot/pilot-verification-plan.json), [probe](candidates/activity-reasons-pilot/reasons-pilot-actual.ts), [helper patch](candidates/activity-reasons-pilot/reasons-materialization.patch), source snapshots, contract and syntax receipts are retained. This was the designated original private clone of actual persisted data, with one reserved connection and one repeatable-read, read-only transaction; 30-second statement and one-second lock budgets, JIT off, 4 MiB work memory and same-backend checks passed. The exclusive preflight observed zero other clone clients under a coordinator lease. This is an observation, not an atomic exclusion primitive.

All three actual SQL policy-function identities, argument/default/result/security/volatility/body contracts matched the retained source history. Seventeen relevant public tables were ordinary tables with no row-level security. The probe verified the original clone still lacks the separate toast column; current main schema includes it, but these Activity paths do not select it. That metadata check does not transfer the prior toast proof or certify all schema provenance.

Both complete DTO and ordered primary results, including pagination fields, matched. The exact compiled SQL and bind values differed by only the materialization keyword. No fake records, provider responses, mutation, DDL or normal-database access were used. Four existing clone owners were available, but this pilot executed only owner ordinal 0; mapping that owner to the normal signed-in viewer is unestablished. The 29 main/runtime/policy source pins remained unchanged. Rollback, reserved connection release, pool closure, no credential-key creation and zero external fetch attempts passed, and the DB lease was released.

## Forward path and tradeoffs

The fence prevents useful as well as expensive outer pushdown. It can materialize an uncapped scoped reason set, consume memory, spill, or worsen unscoped, artist/group, relationship, cursor and other viewer paths. A two-scope positive pilot cannot establish those costs or transfer the prior 64-case query proof to this helper. The next private phase must compare the full current query across the available actual owner/filter/ancestor/cursor cohorts and representative scoped/unscoped plans, retaining empty and adverse outcomes. No absent dated-listen, multi-track, collection-event or artist/group-overlap cohort will be fabricated.

If that broader proof passes, a meaningful maintained current-source regression and common gates still precede adoption, followed by signed-in normal acceptance. This candidate adds no index, dependency, schema, framework or UI change. No source patch is applied and no canonical finding is closed by this report.

## Later broader verification stopped

The [first broader run](activity-reasons-broader-verification.md) matched all 64 historical complete pairs, then stopped at its additional ancestor-selector guard before any new case or plan. A separate actual census confirms 829 season episodes but no saved screen-collection `contains` cohort: the historical 23-member parent uses `collection` links. Failed artifacts and the explicit gap are retained; the candidate remains unadopted.

## Later revised actual proof

The [separate revised run](activity-reasons-unconditional.md) completes 115 unique equal DTO/row pairs and 28 plans. Friend-filtered shared/temp work and watchlist temporary reads increase, so the unconditional helper remains unadopted. Original receipts retain their original status. A selective default-only option requires separate proof.
