# Rejected warm-only completed-season admission candidate

The unadopted completed-season candidate admits only `watched` states with a known last-watch timestamp before joining/grouping. The actual catalogue establishes watched is NOT NULL and the existing unique user/media identity permits at most one state per episode. It still requires the admitted count to equal every non-special episode and applies the unchanged period fence to aggregate MAX(last_watched_at). A partial season cannot become complete by filtering its timestamps to a period. Unrelated activity/rating SQL, bindings and owner statement counts remain identical.

The [actual-data receipt](evidence/implementation-found-15-actual.json) compares 36 complete activity results or privacy errors: four existing enabled owners × all/year/month × self/other/guest. It runs READ ONLY repeatable-read with bounded statements, zero external fetches, rollback/close and runtime-module cleanup. The [exact source manifest](candidates/found-implementation-15/source-manifest.json), before/candidate files and patch retain the measured epochs. Later shared changes are separately recorded; current-source identity does not retroactively rerun historical evidence.

All twelve season query families improve three-pair alternating warm SQL medians, but eleven increase root read-buffer visits and one is unchanged. The largest all-time case rises 11,267→13,196 visits. It was briefly applied, then reverted after the resource review; original completed-season SQL is retained. Cold I/O/resource tradeoffs remain unresolved. Twelve additional complete ordered season-ID/completion-date lists match, including 633 all-time completed seasons for the largest actual owner. No metadata override or synthetic tracking cohort is manufactured.

| Actual owner:period | Sum of measured root buffer visits | Warm SQL median ms |
| --- | --- | --- |
| 0:all | 2,076 → 2,144 | 13.91 → 9.62 |
| 0:month | 2,060 → 2,081 | 13.77 → 9.47 |
| 0:year | 2,076 → 2,144 | 15.14 → 8.19 |
| 1:all | 7,330 → 7,619 | 16.26 → 13.26 |
| 1:month | 2,282 → 2,282 | 14.26 → 11.92 |
| 1:year | 2,706 → 2,717 | 15.48 → 12.06 |
| 2:all | 3,352 → 3,484 | 14.43 → 10.47 |
| 2:month | 2,306 → 2,395 | 13.58 → 11.39 |
| 2:year | 2,513 → 2,631 | 15.95 → 11.15 |
| 3:all | 11,267 → 13,196 | 18.33 → 15.91 |
| 3:month | 2,386 → 2,927 | 12.66 → 11.01 |
| 3:year | 2,656 → 3,233 | 14.03 → 12.08 |

Local serialized SQL plans/timings do not establish pooled HTTP latency, CPU, RSS, browser heap, whole-page speed or production tails. All plans and individual samples, including adverse samples, remain in the receipt. Larger concurrent/resource/growth acceptance remains partial.

[Combined consumer smoke](evidence/implementation-found-14-15-normal.json) reloads authenticated Profile/admin and opens/closes the expanded Year Insights panel: 9 movies, 46 episodes, 3 seasons; 53 unique titles, 55 watches, 44 unique episodes, 1 rated title and 163 genre credits. No preference, provider or playback mutation is submitted. [Final applied-source gates](evidence/implementation-approved-avatar-final-gates.json) pass 844/715 guarded skips/0 failures, 34,242 assertions, type/build/inventories/style; guarded skips are not actual-data acceptance. PLAN-08 remains partial. No commit, push, PR or deployment.
