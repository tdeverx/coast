# Share recorded history across adjacent Profile periods

The shared `profileActivity` owner now materializes the four required recorded-history fields once for the union of current and previous Month/Year periods. The previous-start lower bound and original current end are preserved. Current-period consumers apply their existing lower bound. The previous count uses the original `previousNow.toISOString()` upper bound, including its millisecond gap; substituting `< currentStart` would admit submillisecond events previously excluded. All-time and unrelated season/rating SQL and bindings remain byte-identical. Month/Year owner ORM statements fall from four to three; all-time stays three.

The [actual-data receipt](evidence/implementation-found-14-actual.json) compares 36 complete activity results or privacy errors: four existing enabled owners × all/year/month × self/other/guest. It runs READ ONLY repeatable-read with bounded statements, zero external fetches, rollback/close and runtime-module cleanup. The [exact source manifest](candidates/found-implementation-14/source-manifest.json), before/candidate files and patch retain the measured epochs. Later shared changes are separately recorded; current-source identity does not retroactively rerun historical evidence.

All eight changed Month/Year families improve buffer visits and three-pair alternating warm SQL medians. The four all-time statements are identical: their timing variation and one single-block buffer observation are retained, not counted as improvements.

| Actual owner:period | Sum of measured root buffer visits | Warm SQL median ms |
| --- | --- | --- |
| 0:month | 20,199 → 10,917 | 45.27 → 23.33 |
| 0:year | 20,361 → 11,079 | 45.11 → 19.78 |
| 1:month | 20,699 → 11,417 | 61.70 → 32.34 |
| 1:year | 25,412 → 16,130 | 63.06 → 36.90 |
| 2:month | 13,265 → 7,244 | 57.30 → 30.89 |
| 2:year | 16,254 → 10,232 | 55.35 → 30.93 |
| 3:month | 18,744 → 9,462 | 64.93 → 36.07 |
| 3:year | 22,244 → 12,962 | 90.24 → 49.59 |

Local serialized SQL plans/timings do not establish pooled HTTP latency, CPU, RSS, browser heap, whole-page speed or production tails. All plans and individual samples, including adverse samples, remain in the receipt. Larger concurrent/resource/growth acceptance remains partial.

[Combined consumer smoke](evidence/implementation-found-14-15-normal.json) reloads authenticated Profile/admin and opens/closes the expanded Year Insights panel: 9 movies, 46 episodes, 3 seasons; 53 unique titles, 55 watches, 44 unique episodes, 1 rated title and 163 genre credits. No preference, provider or playback mutation is submitted. [Final applied-source gates](evidence/implementation-approved-avatar-final-gates.json) pass 844/715 guarded skips/0 failures, 34,242 assertions, type/build/inventories/style; guarded skips are not actual-data acceptance. PLAN-08 remains partial. No commit, push, PR or deployment.
