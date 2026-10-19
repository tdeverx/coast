# Completed-season boolean simplification — not adopted

The existing shared completed-season query separately requires `bool_and(t.watched)` and `bool_and(t.last_watched_at is not null)`. This candidate combines them as `bool_and(t.watched and t.last_watched_at is not null)`. It changes no admitted input rows, total-episode comparison or aggregate MAX/period fence. It is independent of the earlier row-filter candidate that increased buffers and was reverted. [Exact patch](candidates/profile-season-booleans/candidate.patch), [source manifest](candidates/profile-season-booleans/source-manifest.json).

The live actual schema enforces watched NOT NULL; IS NOT NULL is a nonnullable boolean expression. Under those inputs, separate all-true requirements and all-true conjunction admit the same groups. Do not generalize this to two nullable inputs: aggregate NULL skipping can make the forms differ. All other owner SQL/parameter arrays and statement counts stay exact.

The [actual receipt](candidates/profile-season-booleans/actual.json) preserves 36 complete results/privacy errors across four actual owners × three periods × self/other/guest. All 12 complete ordered season-ID/completion-date lists match. READ ONLY repeatable-read, JIT off, 30-second statement/1-second lock budgets, zero external fetches, rollback/pool/module cleanup and exact unchanged current source are checked. No fabricated history, user, privacy, metadata or provider cohort is used.

| Actual owner:period | Equal before/after root shared hit+read visits | Alternating warm median ms |
| --- | --- | --- |
| 0:all | 2,076 | 16.104 → 15.774 |
| 0:month | 2,060 | 15.901 → 16.050 |
| 0:year | 2,076 | 13.971 → 13.020 |
| 1:all | 7,330 | 19.431 → 19.336 |
| 1:month | 2,282 | 16.790 → 16.905 |
| 1:year | 2,706 | 17.145 → 16.978 |
| 2:all | 3,352 | 14.453 → 14.439 |
| 2:month | 2,306 | 13.873 → 14.132 |
| 2:year | 2,513 | 14.961 → 14.258 |
| 3:all | 11,267 | 26.524 → 22.878 |
| 3:month | 2,386 | 19.315 → 17.706 |
| 3:year | 2,656 | 21.624 → 22.420 |

All 12 buffer totals are equal and no observed plan spills. Three alternating pairs per family improve eight warm medians and worsen four. The observations do not establish a consistent whole-query benefit; reduced aggregate expression count does not itself measure CPU, heap/RSS or endpoint performance. No claim of statistical significance or cold/pooled/tail behavior is made. Keep the current query and preserve this tested option rather than adopting a cleanup as a proven optimization.

PLAN-08 remains partial. [performance.md](../../performance.md#prove-boolean-aggregate-equivalence-and-performance-separately) records the separate correctness and performance requirements. Runtime source is unchanged from the applied Profile period repair; previous 844 common gates are not rerun for audit-only artifacts. Current report/source/artifact integrity is rerun. Known counts remain 22 open / 38 partial; unchecked areas remain deferred. No commit, push, PR or deployment.
