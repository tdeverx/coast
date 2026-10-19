# Profile activity shared evidence and committed context

Applied in the existing shared `profileActivity` query and Profile resource composition. Daily and genre aggregates reuse one dated recorded-watch relation; retained UI content now carries its committed period through pending/failing refreshes. PLAN-08 and FRT-03 advance but remain partial. This is known-finding implementation, not a new-area audit or completion of the whole queue.

## One exact relation for two aggregates

Before, days and genres rebuilt the same permitted period history in two separate statements. One materialized `profile_activity_events` now feeds both ordered aggregates. The genre relation still counts each distinct media/genre pair, honors override/canonical/latest-snapshot precedence, and ranks every genre before six+Other. Daily aggregation preserves UTC ordering, exact movie/episode counts and known-date rules. Empty results are arrays. The public activity DTO and callers are unchanged. Ratings, completed seasons and previous-period count still execute separately; no claim they share this materialization.

The [final actual-data receipt](evidence/implementation-found-10-actual.json) preserves **36 complete `profileActivity` outputs or matching privacy errors**: four actual enabled owners × three periods × self/other/guest. Self calls admit one fewer intercepted ORM execute; the history subwork is exactly2→1statements. This interception is not a census of every raw SQL/auth helper or all endpoints. Natural self/other results are positive; guest privacy errors remain. No user, metadata override, history or privacy setting is fabricated. Reserved repeatable-read READ ONLY, JIT off,30-second statement/one-second lock bounds, zero fetches, rollback/close and runtime-module removal are checked.

The final source body equals the tested candidate. An earlier candidate passed36actual outcomes but failed type checking because raw JSONB nested fields lacked an explicit TypeScript boundary cast. That [failed check](candidates/found-implementation-10/first-check-failed.log), candidate and receipt remain archived. The corrected final body was independently rerun for all36outcomes; the two runs are the same population, not72independent cohorts. Both retain their own timings.

## Query work and limits

Twelve self/period families each compare the sum of the original two plan roots with the one candidate root. All12use fewer shared hit+read visits; temporary blocks stay0in all captured plans. Three alternating warm sample pairs per family have lower candidate medians in all12final cases, with individual samples retained. Warm values changed materially between captures, so they are local evidence, not stable SLOs. Original Promise.all reads execute through one reserved Bun connection and serialize on that wire; natural10-connection concurrency/endpoint latency, CPU/RSS/heap/network and production tails are unmeasured.

| Actual owner ordinal / period | Root buffer visits | Warm SQL median ms |
| --- | --- | --- |
| 0:all | 20,361 → 11,079 | 48.47 → 31.84 |
| 0:month | 20,199 → 10,917 | 45.96 → 26.72 |
| 0:year | 20,361 → 11,079 | 43.30 → 24.11 |
| 1:all | 47,716 → 38,434 | 127.38 → 96.36 |
| 1:month | 20,729 → 11,447 | 65.86 → 39.26 |
| 1:year | 25,412 → 16,130 | 74.97 → 44.83 |
| 2:all | 25,266 → 15,589 | 58.30 → 39.35 |
| 2:month | 13,334 → 7,313 | 50.50 → 49.21 |
| 2:year | 16,251 → 10,233 | 47.91 → 27.40 |
| 3:all | 63,880 → 54,598 | 108.58 → 99.90 |
| 3:month | 18,794 → 9,512 | 84.13 → 43.89 |
| 3:year | 22,244 → 12,962 | 78.94 → 46.25 |

The original commands could observe different concurrent snapshots; the shared statement intentionally gives days/genres one snapshot. Actual concurrent history changes are not exercised. Full source history still materializes, large daily/genre output stays complete, other Profile counts/plans remain separate, and absent override/privacy/scale cohorts are not accepted by these results.

## Context and values must agree

Native acceptance exposed the pending-label mismatch: choosing Month immediately relabeled retained Year values as Month; settled data was correct. The existing resource snapshot now includes its period. Recap, footer, chart models and drill-down links use that committed period. The segmented control keeps pending intent. Success atomically publishes values/context through the existing latest-request fence; failure retains the old complete snapshot. Server replacement provides its own period. No shared resource API, dependency or visual design changes.

The compiled source regression covers pending, failure, supersession, late stale success and server replacement. Its authored DTOs are supplementary scheduling controls. [Actual normal query acceptance](evidence/implementation-found-10-query-normal.json) verifies real Month 17 / All 56 / Year 55 settled watches and charts; it also records an operational side effect: owner period controls persist preferences. The test exercised month/all/year saves and restored original Year. This is not described as mutation-free; no normal write trace or database comparison was performed.

After the UI repair, [actual visitor acceptance](evidence/implementation-found-10-composed-normal.json) uses an existing friend Profile, which has no owner edit control and returns from `savePreference` before a write. Month shows 18 movies / 111 episodes, All time 76 movies / 1,229 episodes, and expanded insights open/close. Zero new warnings/errors. The native pending interval was not captured because results settled before observation; pending/failure proof remains compiled controls. No provider response, history or setting is manufactured. Differences between dated series and unique/all recorded totals remain existing contracts, not silently normalized.

[Actual visitor insights (private verification image)](publication.md#private-verification-images)

## Verification and maintenance

Final composed [gates](evidence/implementation-found-10-gates.json): **841 passed, 715 guarded skips, 0 failures, 34,235 assertions**, type 0 errors / 0 warnings, build/navigation drift, inventories and style pass. Intermediate query-only gates are separate. The [manifest](evidence/implementation-found-10-source.json), exact [patch](candidates/found-implementation-10/runtime-owner-changes.patch), snapshots and [actual probe](probes/profile-activity-history-real.ts) preserve reviewed source boundaries without overwriting unrelated work. Native CUA/Playwright locators are used because the dedicated Browser plugin is absent. Desktop functional proof is not universal responsive/device acceptance.

[performance.md](../../performance.md#publish-read-context-atomically-with-its-data) records the generic committed-context rule and request-local SQL reuse. Minimal existing-owner composition is preferred to new caches or wrappers. Historical whole-file probes retain their source-drift guard; their receipts do not automatically become fresh runtime proof when source identities advance.

PLAN-08 still includes separate counts/previous-history/rating/season work and growth/resource/concurrency coverage. FRT-03 retains other route/request schedules and natural failed-read gaps. The canonical counts remain 24 open / 36 partial; Tasks keeps its explicitly selected pair; unchecked areas remain on the separate roadmap. No commit/push/PR/deployment or new dependency is introduced.
