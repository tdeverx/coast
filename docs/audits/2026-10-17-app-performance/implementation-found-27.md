# Activity policy keys: native attribution, adoption and retained tradeoffs

The shared `activityFeed` owner now evaluates its existing authoritative permission predicates once per distinct `(event user, section, category)` key within the SQL statement, then joins permitted keys back to the complete admitted event stream. It adds no cross-request cache, early event limit, schema or dependency. Event identity, grouping, privacy, cursor order and complete response fields remain at their existing owners. [Reviewed candidate](candidates/activity-policy-keys/REVIEW.md), [independent review](candidates/activity-policy-keys/INDEPENDENT-REVIEW.md).

Activity is the social Activity shelf on For You and its expanded view, not the whole For You recommendation page. The normal shelf initially requests `category=screen`; the earlier final comparison called the all-media `{}` variant. Item Activity also uses this owner with work/artist/reading-group scope and optional relationship selection. The inbox supplies explicit referenced activity IDs. Profile journals/insights and Popular with friends have separate owners.

## Attribution before the repair

Four alternating original/current process pairs used the same owned actual-data copy, actual admin/catalogue inputs and native pool size 10. All complete ordered DTOs matched. Median all-media owner time was 9.960→8.431s, while screen Activity was 8.644→10.309s. Primary SQL dominated: 9.266→8.167s and 8.469→10.012s; ordinary hydration-tail medians were about 0.18–0.28s. These mixed observations did not justify a whole-owner rollback.

Exact captured original/current primary SQL and parameters differed only by whitespace and one lateral parent guard. Scoped event admission and relationship-reasons materialization do not run in either unscoped shape. The parent guard reduced actual fallback scans from 13,902→1,558 for all media and 12,757→413 for screen, and remains in the repair. Lower statement counts alone did not explain latency. [Original/current attribution](evidence/activity-policy-keys/original-current-attribution.json).

## Repeated native comparison

Four alternating before/policy process pairs measured full unchanged native owners without EXPLAIN during timing. Here “before” is the current audit branch immediately before this Activity repair, not the untouched original commit. Complete raw DTO hashes and sizes matched across all eight executions per case. These are local native-owner observations, not authenticated HTTP, browser timing, production p95 or database-process CPU measurements.

| Request | Before median | Policy median | Primary SQL before / policy | ORM statements | JSON bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| All-media Activity | 9,195.188ms | 933.917ms | 8,938.389 / 696.784ms | 23 / 23 | 1,716,425 |
| For You screen Activity | 9,403.659ms | 653.637ms | 8,835.861 / 494.752ms | 19 / 19 | 1,688,512 |

Full-owner medians improve 9.85× and 14.39×; primary-query medians improve 12.83× and 17.86×. This reduces repeated work within the same statement, not returned data or query count.

Four alternating pairs for each smaller scope retain every result, including the adverse empty case:

| Actual scope | Items / events | Before median | Policy median |
| --- | ---: | ---: | ---: |
| Direct positive item | 1 / 1 | 166.612ms | 159.394ms |
| Empty season, relationship all | 0 / 0 | 208.362ms | 224.723ms |
| Explicit activity IDs | 3 / 3 | 154.641ms | 147.329ms |
| Artist | 3 / 3 | 21.217ms | 21.136ms |
| Populated show, relationship all | 2 / 1 | 351.614ms | 337.415ms |

All complete outputs match within each scope. The populated show has two output cards but one event; these counts are not interchangeable. Small/empty feeds do not inherit the global feed's tenfold gain. No exhaustive medium/filter cross-product or production-load claim follows from these finite cohorts.

## Native correctness and drift guard

The 22 full native current/candidate acceptance cases compare complete ordered DTOs or native errors over actual records. Controlled permission/friendship changes occur only inside rollback transactions; both variants prove transaction binding and restoration. The matrix covers:

- All, screen, actual event kind, native cursor, direct work, retained explicit IDs, empty explicit IDs, month/kind options, work relationship, invalid relationship without a target, and actual artist options.
- A positive existing-peer friend filter; private peer section/category; withdrawn peer/viewer social and screen features; withdrawn friendship; disabled peer; withdrawn self screen; and self social withdrawal retaining the owner's event.

The same actual `coast_category_enabled`, `coast_feature_enabled` and `social_visible` definitions are verified `STABLE`. The maintained admission regression compares the current key join with the original per-event authority over 13,902 global, 3,387 actual-work and two explicit event identities. The existing scope regression also passes 16 comparisons, including reading-group/intersection and duplicate-ID cases; its two missing natural overlap cohorts remain recorded gaps. Full native reading-group DTO acceptance is not claimed by the 22-case suite. No identities, catalogue or provider replies were fabricated. [Acceptance](evidence/activity-policy-keys/acceptance-summary.json), [maintained tests](../../../tests/activity-policy-admission-db.test.ts).

## Plan cost, without double-counting buffers

Six exact captured primary SQL/parameter plans were executed separately after timing. These are one ordered EXPLAIN observation per variant/request. The following buffer counts are inclusive root totals, never sums of ancestors and children. Shared reads are buffer-cache misses, not proof of physical disk I/O.

| Request / variant | Planning ms | Execution ms | Shared hits | Shared reads | Temp read / written blocks |
| --- | ---: | ---: | ---: | ---: | ---: |
| All / original | 35.701 | 9,784.154 | 1,533,909 | 2,477 | 0 / 0 |
| All / before policy | 2.981 | 8,978.307 | 1,067,270 | 0 | 0 / 0 |
| All / policy | 10.287 | 1,137.601 | 288,511 | 1,101 | 422 / 422 |
| Screen / original | 3.457 | 8,730.374 | 1,450,485 | 0 | 0 / 0 |
| Screen / before policy | 12.150 | 10,701.254 | 981,413 | 0 | 0 / 0 |
| Screen / policy | 4.850 | 1,104.191 | 233,534 | 0 | 422 / 422 |

Both policy plans produce 12 distinct keys and retain all 12 permitted keys. Additional key building scans 13,902 activity rows and 147,946 works once; it finishes in 55/37ms, with allowed-key materialization complete in 62/46ms. The key aggregate peaks at 24kB; the works hash peaks at 4,997kB and spills in two batches. Root temporary traffic is 422 blocks each direction, about 3.30MiB each at standard 8KiB blocks; block size was not newly probed. Final top-N sorting stays at 64kB, and added small quicksorts use 25kB each. Node peaks are not summed into a process-memory claim.

Root shared hits fall 73.0%/76.2% against before-policy plans. Parent fallback loops remain exactly 1,558/413 in the policy candidate. The modest extra scan/hash/spill is a disclosed cost, justified here by preserved outputs and the repeated large-feed gain, not a universal optimization rule. [Public-safe plan evidence](evidence/activity-policy-keys/six-plans.json); raw SQL, parameters and plan filters remain private.

## Tasks and normal browser acceptance

Tasks source and its three captured native SQL/parameter sequences are unchanged. A separate same-copy attribution run compares 32 complete native calls: all return the same 23 actions and 14,093-byte DTO. Overall original/current medians are 56.875/45.143ms; first-owner-call medians 70.522/68.308ms and warm medians 55.007/43.077ms. The earlier 40→57ms adverse observation does not reproduce as a source-attributed regression. Keep the existing task query/index pair; no Tasks repair or rollback is adopted. [Tasks attribution](evidence/activity-policy-keys/tasks-attribution-summary.json).

Normal signed-in 5173 acceptance passes For You Activity → expanded Activity → Listening with three real rows → Watching episode groups → a populated show's direct Activity route with two cards and a five-episode caption. Console warnings/errors are zero and the temporary tab is closed. This confirms rendered navigation/content, not browser performance. [Browser receipt](evidence/activity-policy-keys/browser-acceptance.json).

Final integrated gates pass 844 common tests with 716 guarded skips and zero failures, plus type-check, build, code/UI inventories and style. Two maintained actual-data tests pass separately (47 assertions). Logical restoration checks 102 tables / 1,864,145 rows; this is not proof of physical WAL/tuple rollback or every database object. The owned disposable comparison copy was dropped and absence confirmed. Receipts: [gates](evidence/activity-policy-keys/gates.json), [restoration](evidence/activity-policy-keys/restoration.json). Historical failed/preflight and adverse results remain preserved. No commit, push or PR is part of this batch.
