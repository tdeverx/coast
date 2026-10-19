# PLAN-06: materialize the shared missing-demand Collection boundary

The [shared demand statement](../../../src/lib/collection/demand.server.ts#L14) now materializes its existing Collection result once before the existing candidate/assessment join. All **76 complete actual-data pairs matched**, plus four repeated timing pairs. The change removes a large repeatedly scanned reasons spool without changing fields, filters, paging or policy. [Machine-readable scope, pins and all six representative tradeoffs](implementation-demand-materialization.json).

This is a **partial PLAN-06 repair**. Admin still calculates demand for all admitted users before its final user page. No count/detail split, schema/index, new policy, cache, framework or global planner setting was adopted. Four saved consenting users cannot establish large-user scalability, consent-withdrawal or live API resource acceptance.

## Root cause and exact boundary

The [root baseline](evidence/admin-demand-actual.json), produced by its [source-shaped probe](probes/admin-demand-real.ts), established four consenting users, 197 missing items and 115 returned details. The default plan repeatedly materialized reasons beneath the Collection-to-next-assessment join: a reasons spool averaged 8,614 rows and was entered 7,062 times, recording 1,950,056 temporary block reads at that node.

The repair is confined to `demandStatement`: append `demand_collection as materialized (select * from collection)` after the existing `collectionCTE`, then select candidates from `demand_collection c` instead of `collection c`. The shared Collection definition and its existing materialized assessments remain unchanged. The planner can finish this exact Collection result before rejoining its next-item assessment instead of repeatedly scanning the expanded reasons join.

This boundary stays inside each owner's existing statement, including each correlated Admin lateral invocation. It creates no result shared between users or requests. Category/policy/visibility functions are declared SQL `STABLE`, and existing query time, snapshot and source correlation remain. Active/planned reasons, release/availability filters, category rules, distinct-next-target preference and tie order, source/request arrays, user/item totals and both page clamps are untouched. The Library missing view, Admin page and authenticated missing/admin-demand endpoints all call this same owner. Existing API session/admin authorization remains outside the read owner and was not changed.

Materialization can retain more intermediate rows and prevent useful pushdown. That cost was measured on small and source-filtered cohorts before adoption; it is not assumed free.

## Actual proof

All experiments used the approved actual-data clone, explicit repeatable-read READ ONLY transactions and verified 30s statement / 5s lock budgets. They retained the existing Collection `jit=off` and `recursive_worktable_factor=0.01`, with no global change. Exact baseline and private-candidate function bodies used the current canonical dependencies; only the existing `collectionRead` executor was redirected to the bounded transaction. No fabricated accounts, catalogue, history, settings, source/request rows or consent state were used. No provider fetch, normal database access or schema/DML mutation occurred. All transactions ended and pools/runtime modules closed.

The [initial comparison and two plans](evidence/implementation-demand-materialization-default.json) matched the complete default Admin DTO: four users, 197 missing items, 115 details and 68,351 mapped bytes.

The [broader proof](evidence/implementation-demand-materialization-variants.json) matched **69 more complete pairs**:

- Six default Admin combinations of inner `itemsPage` 1/2/10,000 and outer user page 1/10,000.
- Twelve actual user-filter/inner-page combinations across all four accounts.
- Fifty-one personal combinations covering `all`, each of nine actual owned connection IDs and an existing other-owner connection ID, each with page 1/2/10,000.

All fields and source/request array ordering were compared, not just identities/counts. No positive request-array cardinality was separately retained, so do not infer nonempty coverage for every field. The saved owners have default demand totals 10/38/7/142; the largest supplies real second and clamped-last item pages. All four users fit one outer Admin page. There are zero saved disabled or opted-out users; those states were not manufactured.

The raw broad receipt stores the **returned/clamped** `page`, overwriting its requested outer-page label. The exact executed probe contains the request schedule. A separate [derived request-index mapping](evidence/implementation-demand-materialization-request-schedule.json) reconstructs those actual arguments by ordinal and labels that derivation explicitly. Raw receipts and DB results were not rewritten, and repeated returned page 1 values are not claimed as different returned pages.

Finally, [six representative comparisons and twelve plans](evidence/implementation-demand-materialization-work.json) checked the actual smallest and largest owners, each with all sources, the first actual owned connection and an existing other-owner connection. These extra six complete pairs matched. They test additional materialization/pushdown work directly rather than extrapolating from default Admin timing. Other-owner source IDs remain subject to the unchanged owner-connection predicate; they do not admit another account's sources.

## Read work and tradeoffs

Whole-query buffer and temporary counters below come from the **root plan node**, never sums of parent/child counters. Shared Read Blocks are PostgreSQL read counters; OS cache may serve them, so they do not prove physical disk I/O. The retained raw estimate named `totalRowsRemovedByJoinFilters` multiplies rounded per-loop metrics and sums filter nodes; it is an approximate aggregate of discarded join pairs, not an exact count of unique pairs.

| Default Admin plan | Before | Candidate |
| --- | ---: | ---: |
| Shared Hit Blocks | 2,387,723 | 2,351,522 |
| Shared Read Blocks | 129,828 | 133,234 |
| Temp Read Blocks | 2,003,226 | 55,900 |
| Temp Written Blocks | 32,097 | 33,233 |
| Repeated reasons-spool loops | 7,062 | eliminated |
| One EXPLAIN execution sample | 10,036.285ms | 5,112.473ms |
| Four alternating warm owner-call pairs, median | 6,871.435ms | 3,974.802ms |

The reduced repeated temporary reads are an actual plan-work reduction. The extra writes and Shared Read Blocks remain visible. The repeated warm samples measure local full read-owner calls, including mapped DTO construction, not HTTP/auth transport, normal-browser latency, production tail latency, CPU/RSS or WAL.

Representative root-node temporary counters show the cost distribution:

| Actual owner/source scope | Missing total | Temp Read Blocks before → after | Temp Written Blocks before → after | Shared Read Blocks before → after |
| --- | ---: | ---: | ---: | ---: |
| Smallest / all | 7 | 12,953 → 13,033 | 8,923 → 9,003 | 16,959 → 16,671 |
| Smallest / own connection | 7 | 12,953 → 13,033 | 8,923 → 9,003 | 15,807 → 15,519 |
| Smallest / other-owner connection | 29 | 12,953 → 13,033 | 8,923 → 9,003 | 14,655 → 14,367 |
| Largest / all | 142 | 1,963,364 → 15,607 | 11,515 → 12,220 | 41,456 → 38,690 |
| Largest / own connection | 264 | 1,997,344 → 15,604 | 11,515 → 12,214 | 39,629 → 51,904 |
| Largest / other-owner connection | 264 | 2,594,704 → 15,604 | 11,515 → 12,214 | 38,350 → 48,297 |

The smallest owner's new boundary scans 1,469 intermediate rows, returning 32 past its filter. It adds 80 temporary read and write blocks in each sample while removing a smaller repeated reasons spool; Shared Hit Blocks decline 7,825 and Shared Read Blocks 288. All six single owner-call/EXPLAIN observations improved in this run, but those individual samples do not establish per-variant latency distributions. No actual empty-demand owner was available. The explicit small extra-spool cost is accepted against the confirmed default/large reduction; future data distributions still need measurement.

The largest owner materializes 13,153 rows, returning 265 past the boundary filter. The previous large reasons spools disappear across all three selected-source plans. Additional materialized storage and remaining full assessment/history work are not solved by the repair. The full six-case metrics and sanitized plan trees remain in JSON.

## Maintenance and remaining work

Production stayed at the baseline pin throughout verification, then adopted the exact verified candidate `d4184856…5615c1b`. Independent read-only review found no material semantic blocker and specifically requested the small/filter tradeoff checks; it performed no DB/test run. No new authored fixture was added: actual saved 142-item demand already exercises inner paging, while existing guarded [Collection tests](../../../tests/collection-db.test.ts#L82) protect opt-out, empty-user filtering/clamping and album next selection, and [feature-boundary tests](../../../tests/feature-boundaries-db.test.ts#L55) cover disabled media. Their presence is not represented as fresh executed fixture acceptance. Root owns combined gates and normal-browser acceptance.

The [captured baseline](candidates/demand-materialization/demand.before.ts.txt), exact executed [default](probes/demand-materialization-candidate-actual.ts), [matrix](probes/demand-materialization-candidate-variants.ts) and [representative-work](probes/demand-materialization-candidate-work.ts) probes retain pre-adoption behavior/pins. The historical work probe depends on its original prior private receipt to choose owner bounds. The maintained [matrix replay](probes/demand-materialization-real.ts) and [representative replay](probes/demand-materialization-work-real.ts) instead admit the captured baseline/current candidate, use relocatable roots, retain requested page labels correctly and select current actual bounds afresh. Both were syntax checked without another DB run. Replays fail on source drift rather than silently accepting another implementation.

Large consenting-user scale, changed consent/privacy, truly empty demand, live API authorization and production resource measurements remain explicit gaps. A count/detail split requires its own exact total/filter/paging contract and is unadopted. No universal cache, user limit, synthetic population, index or new retention policy is inferred from these plans.

DATA-05 is a separate unadopted progress-aggregation lead. The root baseline census found 89,830 screen-state rows and **zero dropped rows**. No progress source was changed, and this report does not claim execution of the separately prepared progress probe or a positive dropped-state acceptance.
