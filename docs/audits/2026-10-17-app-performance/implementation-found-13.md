# Narrow the shared Profile activity materialization

Applied in the existing `profileActivity` owner used by Profile insight sections, panels and initial activity composition. Its materialized history now selects only `media_id`, `kind`, `occurred_at` and `occurred_at_known`, which are the complete inputs needed by the day and genre aggregates. Full returned DTOs and privacy remain intact. This advances the known PLAN-08 aggregation work without touching unchecked areas or waiting for the separate avatar/migration rollout decisions.

## Verified effect

The [actual receipt](evidence/implementation-found-13-actual.json) compares36complete outputs or matching privacy errors: four existing owners × all/year/month × self/other/guest. It includes small histories and the real4,284-day history. No missing history, guest-visible policy, metadata override, source or book cohort is manufactured. Dates, totals, genres, previous-period count, ratings and completed seasons match in every complete result. Query counts remain unchanged: the self path still has3owner ORM statements for all-time and4for month/year, in addition to the existing auth/config reads outside that interception boundary.

All12measured plans remove an unused `WindowAgg` stage,2→1, and change the materialized row-width estimate176→32bytes. Narrowing the projection lets PostgreSQL prune the otherwise demanded `rewatched`/prior-watch-count output and its window calculation. Those fields remain available to the separate history reader that needs them; the canonical recorded-watches helper and full page DTOs are unchanged.

All12root shared hit+read visit counts are equal. No plan writes temporary blocks before or after, so this is not a measured spill reduction. Row width is the planner's estimate, not measured heap/RSS or an82%memory claim. Eleven of12three-pair warm medians improve; the remaining small case is19.07→19.18ms. This is local serialized SQL work, not pooled endpoint latency, CPU, browser heap, wire size or production tails.

| Actual owner | All-time median ms | Year median ms | Month median ms |
| --- | --- | --- | --- |
| 0 | 19.26→19.01 | 19.07→19.18 | 17.89→17.74 |
| 1 | 61.45→54.08 | 62.77→27.92 | 39.15→22.61 |
| 2 | 21.09→20.43 | 20.51→17.68 | 17.34→16.23 |
| 3 | 76.97→70.15 | 29.07→25.23 | 28.11→23.44 |

All plans, samples, unchanged buffer counts and the adverse timing remain in the [summary](candidates/found-implementation-13/plan-summary.json). No index, cache, source filter, data cap, dependency or snapshot/transaction change is added. The one-line [patch](candidates/found-implementation-13/runtime-owner-changes.patch), before/candidate snapshots and [manifest](candidates/found-implementation-13/source-manifest.json) preserve unrelated work.

## Normal consumer and gates

[Signed-in normal acceptance](evidence/implementation-found-13-normal.json) reloads the actual Profile/admin page, opens Activity, in perspective, and verifies the existing Year summary/charts:9movies,46episodes,3seasons,53unique titles,55watches,44unique episodes,1rated title and163genre credits. The panel closes, Year remains selected, the page stays nonblank and no warning/error is captured. No period, playback, profile or provider control is changed. Browser plugin is absent; native CUA/Playwright is used on the already authenticated normal5173tab. This is current-source consumer smoke; complete cross-period/privacy proof is on actual cloned data.

[Actual normal insights (private verification image)](publication.md#private-verification-images)

[Gates](evidence/implementation-found-13-gates.json) record841canonical passes /715guarded skips /0failures /34,235assertions plus current-source type/build/inventory/style checks in an isolated cache. The separate prospective-avatar overlay was also checked; it is not substituted for current applied-source compilation. No mirror implementation test or fabricated DB setup is added. [performance.md](../../performance.md#project-only-the-fields-a-materialized-consumer-needs) records the reusable rule.

PLAN-08 remains partial: separate previous-period/season/rating reads, broader concurrency and resource/growth acceptance remain visible. The [Taste measurement](taste-query-measurement.md) is separate evidence and is not added as Profile savings. Avatar adoption and normal0064rollout remain pending. No commit, push, PR or deployment.
