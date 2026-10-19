# Shared ancestor aggregation — actual helper replay

**Applied; actual helper equivalence and rollback verified. App-wide acceptance remains partial.** This was the baseline “Ancestor refresh after progress” opportunity in [data-api.md](data-api.md), outside the 94 canonical records. It is tracked as additional observation `ANCESTOR-AGGREGATE-OBS-08`, with DATA-02/DATA-07 overlaps; its gains are counted once. The [machine report](implementation-ancestor-aggregation.json) retains current pins, exact metrics, boundaries and reproduction artifacts.

The existing shared `refreshAncestors` and `refreshCollections` helpers transferred complete child watched/play-count/date rows, filtered and sorted them in JavaScript, then wrote one parent summary. They now select one COUNT/FILTER/MIN/MAX row. Show/season regular-child scope, empty-child behavior, missing-state minimum 0, collection duplicate-child deduplication, Date decoding, saved-date fallback, ordinary transition play counts and rebuilding minima remain intact. Parent SHARE fences, policy/account lock order, recursion, projection row locks, writes and updatedAt observations are unchanged. No dependency, schema, cache, background job or UI design is added.

## Actual proof

Four existing owners supply 14 actual saved cohorts, exercised in ordinary then rebuilding mode in each variant:28 paired helper cases. No catalogue, user, event, tracking state or relationship is fabricated to fill a gap. The largest regular show has 6,903 children and all 6,903 tracking rows missing for the selected owner; positive dates/completion come from separate real cohorts.

| Existing cohort | Regular/member children | Watched children | Dated children |
| --- | ---: | ---: | ---: |
| largest regular show | 6903 | 0 | 0 |
| actual partial dated show / owner 0 | 91 | 11 | 11 |
| actual complete dated season / owner 0 | 10 | 10 | 10 |
| actual dated collection / owner 0 | 6 | 1 | 1 |
| actual partial dated show / owner 1 | 806 | 800 | 800 |
| actual complete dated season / owner 1 | 38 | 38 | 38 |
| actual dated collection / owner 1 | 12 | 3 | 3 |
| actual partial dated show / owner 2 | 806 | 270 | 263 |
| actual complete dated season / owner 2 | 26 | 26 | 26 |
| actual dated collection / owner 2 | 12 | 2 | 2 |
| actual partial dated show / owner 3 | 806 | 799 | 799 |
| actual complete dated season / owner 3 | 38 | 38 | 38 |
| actual dated collection / owner 3 | 23 | 1 | 1 |
| actual special only season | 0 | 0 | 0 |

The special-only season has 829 actual special episodes and zero regular children. Every helper step compares the entire account tracking-state value digest. After each whole variant, every row value in all 102 public/drizzle tables is compared, including revisions and all tracking columns/timestamps; exact inserted/deleted/changed tracking key digests, DML and statement admission also match. All database values and sequences restore after outer rollback:1,864,145 rows. Native mapped positive dates are finite Date objects in both variants. No provider call occurs.

| Instrumented helper work across 28 calls | Before | Applied |
| --- | ---: | ---: |
| Child projection statements | 48 | 48 |
| Child projection mapped rows | 28,054 | 48 |
| Child projection JSON representation, bytes | 1,638,240 | 4,250 |
| All mapped ORM rows | 28,276 | 270 |
| All mapped JSON representation, bytes | 1,676,793 | 42,803 |
| ORM statements | 296 | 296 |
| Bound parameters | 1,074 | 1,074 |
| Tracking DML statements / affected-or-returned rows |96 /55 |96 /55 |
| Tracking keys inserted /deleted /changed |7 /0 /16 |7 /0 /16 |

These are actual instrumented result counts and serialized representation proxies. They are not measured driver wire bytes, retained/peak heap, CPU, WAL or browser performance. Required parent writes and statement counts are unchanged.

## Plans and tradeoffs

The largest child read returns 6,903→1 rows. Both plans still visit the same 6,903 episodes and 23,793 existing account tracking rows. Root shared-block accesses total 674 in both observations; the candidate observes warmed blocks (baseline 429 hits+245 reads; candidate 674 hits). The selected season read returns 249→1 rows with 765 total root accesses in each. There is no temp traffic. Individual elapsed samples 5.140→3.905 ms and 1.190→0.310 ms are descriptive and cache-ordered. No timing repeats were used to turn these into a distribution or universal speed claim. Aggregation adds server reduction work while avoiding child result transfer, mapping and JavaScript sorting.

## Safety, failed probe and reproduction

The designated private actual-data clone is guarded by host/port/database name and an explicit rollback marker. Metadata and plan transactions verify READ ONLY/repeatable read/30 s statement and 5 s lock budgets. Owner replay uses repeatable read,30 s/5 s, fixed module observation time, one shared PostgreSQL transaction timestamp and real nested savepoints; all deferred revisions are flushed before comparison. Locks persist until the outer rollback, so ordinary commit/concurrency schedules are outside this proof. The full top-level track/bulk/rebuild admission, event creation and webhooks are not invoked.

The [first receipt](evidence/ancestor-aggregation-failed-1.json) is a retained probe import failure before either helper variant ran. Its read-only census completed, no domain write was admitted, and the pool closed. The [failed exact script](probes/ancestor-aggregation-failed-1.ts) used a line-based relocation matcher; the passed probe scans all emitted import paths, including multiline/dynamic imports. This is a harness correction, not an app failure.

The [exact passed executed probe](probes/ancestor-aggregation-candidate-actual.ts), [passed receipt](evidence/ancestor-aggregation-actual.json), [baseline](candidates/ancestor-aggregation/service.before.ts.txt) and [adopted candidate](candidates/ancestor-aggregation/service.candidate.ts.txt) remain immutable. The executed script expected the pre-adoption baseline. The [portable current-source replay](probes/ancestor-aggregation-real.ts) instead accepts the exact adopted candidate; it is syntax checked only, not an additional executed proof. Use the existing approved in-memory credential runner against the designated private clone, with `COAST_AUDIT_ANCESTOR_ROLLBACK=1`; no credential or raw private rows belong in evidence. Any semantic drift requires review and a new full proof.

## Remaining acceptance and options

Keep the aggregate owner as the smallest change. A later counter/cache model could avoid repeated child scans, but would add membership/repair/replay invalidation and concurrency complexity; it needs a concrete design decision and separate proof. No cache, trigger counter or compatibility layer is introduced here.

Actual franchise and repeated cross-kind collection paths are absent. Tableless source-derived controls will protect empty/missing/partial/full/date/fallback/minimum/duplicate-ID contracts as supplemental correctness evidence. Top-level command/concurrency acceptance remains in the existing DATA-02 work, with saved rewatches/playlists absent. Normal UI reads do not exercise parent writes. Current batch gates, regression receipt and normal functional acceptance are recorded below.

The maintained [ancestor regression](../../../tests/tracking-ancestor-aggregate-db.test.ts) passed 2 tests/55 assertions on the private clone, each inside verified READ ONLY 10 s/1 s. [Receipt](evidence/ancestor-aggregation-controls.json), [transcript](evidence/ancestor-aggregation-controls-tests.txt) and [runner](probes/tracking-ancestor-aggregate-controls.ts) distinguish tableless authored controls from actual catalogue replay. Empty/missing/partial/full/special scope, date fallback/minima and collection duplicate-ID/no-query cases are protected.

Current combined gates:791 pass/710 guardedskip/0 fail/33,722 assertions across 1,501 tests/279 files; typecheck 0 errors/0 warnings; build/inventories/style passed. The [frozen authenticated normal 5173 trial](evidence/implementation-ancestor-material-normal.json) passed account/nested/task/movie/comic menus, Library 120 media links/28 completedimages, Read 12 actualcomics, Continue 34 links/13 completedimages, Admin and final 30 pausedTasks, with 0 dialogs/0 popovers/0 newwarnings/errors and unchangedsource. Open menus usednativeglass; closedmenuowner markers were 0 and the originalaccountfilter wasremoved. CustommediaEnteropens, whileArrowDowndidnot; sharedaccountArrowDown/nestedArrowRight/Escape passed. No mutationcommand was submitted, and no liveingestion/helperwrite/CPU/heap/GPU/network/touch/longsoak claim is made.
