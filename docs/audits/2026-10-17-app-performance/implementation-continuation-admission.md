# Continue state admission — partial implementation

The shared screen progress planner now excludes states that neither of its two consumers can use, before calculating effective replay fields and mapping rows into JavaScript. This benefits Continue, Next, Up Next, the progress route/API and the initial home hero through their existing owner. No cache, index, descendant rewrite or planner setting was added. Current pins, exact counts and artifact hashes are in the [machine report](implementation-continuation-admission.json).

## Why the filter is safe

Both consumers already reject dropped states. Effective watched requires stored watched. Without a replay boundary, positive effective progress requires a positive stored position. With a boundary, progress can instead come from the latest applied event. The new necessary condition therefore retains **every direct or inherited canonical replay boundary**, including rows whose stored position is zero. An own replay also has a non-null direct boundary under the existing schema.

The condition is conservative: a boundary-only row may still be projected and later rejected. A stored-position-only filter would lose valid replay progress. Relative order of all used states is unchanged. Queue, saved titles, descendants, parent-drop rules, availability, sequence occurrences, privacy, card hydration and page selection keep their existing owners.

## Actual saved-data verification

The [executed candidate receipt](evidence/progress-state-admission-candidate-actual.json) contains **184 complete equal comparisons**: 144 planners across four owners, three views, three kinds, two scopes and first/overlarge pages; 24 complete public progress results; four hero selections; and 12 cross-profile outcomes. Sequence Map insertion order was compared separately rather than treated as an unordered mapping. No provider calls or database writes occurred. Each existing operation retains its transaction boundary on one reserved READ ONLY repeatable-read connection, with verified 30-second statement and five-second lock limits. Separate operations are not claimed to share one outer snapshot.

The [census](evidence/continuation-state-census.json) found 89,830 saved screen states, of which 69,503 were unused by either consumer:

| Actual owner ordinal | Initial state rows before | After | Rejected |
| --- | ---: | ---: | ---: |
| 0 | 23,793 | 61 | 23,732 |
| 1 | 24,437 | 7,194 | 17,243 |
| 2 | 16,636 | 1,424 | 15,212 |
| 3 | 24,964 | 11,648 | 13,316 |

For the first owner's complete Watching result, mapped ORM rows fell from 24,935 to 1,203 and their serialized JSON size from 3,772,857 to 384,196 bytes, with the same 23 statements and identical output. On the largest-state owner, complete Watching mapped rows fell from 43,200 to 29,884, with the same 27 statements. These byte counts describe mapped results, not PostgreSQL wire bytes or measured heap retention.

Four alternating full `progressData(watching)` pairs on the largest-state owner, with row/byte instrumentation disabled, had warm local medians **587.39 → 548.59 ms**. The first candidate sample was slower; these are descriptive local samples, not production tail estimates. The single initial-state EXPLAIN returned 24,964 → 11,648 rows, recorded 84.411 → 57.305 ms and 198,204 → 76,067 shared hits. It also recorded **1,561 → 3,865 shared read blocks**. Do not interpret this as a universal I/O, CPU or memory improvement, or sum counters from ancestor plan nodes.

## Supplemental replay controls and calibration

The actual clone has no saved rewatches, started playlists or dropped screen states. Those are explicit positive-cohort gaps. The [source-derived regression](../../../tests/progress-state-admission-db.test.ts) compiles the current initial query and both actual consumers, using the canonical replay helpers over 17 authored tableless states. It covers direct movie replay, inherited show/season replay, child-season boundaries on shows, boundary-only conservative admission, dropped/negative/unused states, old watched reset and a later watch event clearing progress. The [READ ONLY control receipt](evidence/progress-state-admission-controls.json) passes one test and eight assertions. No fixture catalogue was written, and these cases are not actual-media performance evidence.

The first control harness interpreted the source's `sql<boolean>` generic as JavaScript and failed before SQL comparison. Transpiling the source projection fixed that harness; its [failed receipt](evidence/progress-state-admission-controls-setup-failed.json) is retained. The application predicate did not change. Independent predicate/query/consumer/case review found no material issue.

## Reproduction and remaining work

The [immutable baseline](candidates/continue/progress.before.ts.txt) and [exact executed candidate probe](probes/progress-state-admission-candidate-actual.ts) identify the compared implementation. Its candidate is byte-identical to the adopted source. The [post-adoption probe](probes/progress-state-admission-real.ts) reads that baseline and verifies the reviewed current source pin; it was syntax checked, not rerun. The [control runner](probes/progress-state-admission-controls.ts) executed the supplemental test. The earlier dropped-only probe remains unexecuted and establishes no actual saving.

This is a partial repair of DATA-05. Descendant scans, recursive selection, full card hydration and repeated plan invocations still execute. Next, measure the exact descendant work for actual started shows and sequences. Reuse a request-local plan only when a real request needs the same viewer/options/snapshot twice. A larger SQL or durable projection must first preserve seasons, specials, ordered occurrences, replays and concurrent membership rules. Actual playlist/replay mutations, token HTTP, browser resource/timing and concurrent-boundary schedules remain unverified.

Root combined acceptance: [787passed/708guardedskip/0fail, clean check/build/inventories](evidence/implementation-verification.json) and the [frozen signed-in normal5173 trial](evidence/implementation-shared-admission-normal.json) passed. Actual Continue/Next, friend taste/overlap, Library/music detail/settled Back, Admin and30Tasks rendered without new warnings/errors or source drift. No live recommendation job or admitted Planning creation is inferred.
