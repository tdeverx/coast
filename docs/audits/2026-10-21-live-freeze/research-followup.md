# Recommended shared fix after further investigation

**Subsequent decision:** the user requested Bun 1.4.4. See [runtime adoption](runtime-adoption.md) for the selected immutable official image, its separate acceptance and deployment status. The measurements below remain evidence for their original revision.

**Use the upstream Bun SQL fixes, preserving prepared statements and the native
JSON contract.** They address the driver beneath every shared database caller.
Do not adopt the earlier global `prepare: false` workaround or build a separate
cache per route. Production adoption remains pending: the verified upstream
artifact is **1.4.4-canary.1+963452075**, while the latest official stable release
checked during this investigation is still **1.4.3**.

The preferred production delivery is an official pinned stable release
containing the verified fixes. A pinned canary is a concrete earlier-adoption
option after full application acceptance and explicit rollout authorization.
It is not automatically safe because its scoped tests pass. Production has not
been changed by this research.

## Why this is the best verified option

The deployed image runs `1.4.3+c6da4a4d3`. Its statement signatures include
runtime parameter type/null patterns. Actual 50-row batches therefore retain
new statements even when the INSERT text is identical. The inspected stable
cache has no normal size-based eviction. This is a verified defect, although
the original frozen guest's allocations were not captured and cannot now be
fully attributed to it.

An older proposed SQL-text-only fix was rejected because it could reuse the
wrong parameter type. Its cache-limit PR also closed without merging. Further
research found the newer [upstream consolidation, merged 17 October](https://github.com/oven-sh/bun/commit/017b2439a7a75c82c7a86a294badd8ef2fc30e28).
The tested canary contains these related changes:

- Statement reuse checks compatible declared/server-resolved types; NULL can
  reuse a compatible statement without blindly reusing an incompatible number
  or text statement.
- The cache retains at most 1,024 statements per connection, evicts unused
  entries and sends PostgreSQL Close messages. It avoids evicting a statement
  still held by an active request.
- Native JSON binding works in both prepared and unprepared modes in the
  actual metadata comparison. No application JSON codec workaround is needed.
- Lifetime expiry marks busy connections for retirement, preserving active
  reservations/transactions and retiring the connection after release.

Sources matching the tested revision:
[statement compatibility and cache](https://github.com/oven-sh/bun/blob/963452075/src/sql_jsc/postgres/PostgresSQLStatement.rs),
[server Close messages](https://github.com/oven-sh/bun/blob/963452075/src/sql_jsc/postgres/PostgresSQLConnection.rs),
[connection retirement](https://github.com/oven-sh/bun/blob/963452075/src/sql_jsc/shared/ConnectionTimers.rs).
[Upstream receipt](upstream-research.json) records the exact binary/archive
checksums, official release asset ID and stable/canary source revisions. The
downloaded archive matched GitHub's published digest. A rolling `canary` URL is
not an acceptable production pin.

## Actual-data acceptance and measurements

All mutation tests target disposable databases containing the previously
approved actual catalogue cohort: **8,000 complete media rows and 32 complete
metadata rows**. No rows are fabricated, no live task/provider actions are
dispatched, and no new live catalogue/user export is made. The original approved
checkpoint is reused. All tests use Linux ARM64, PostgreSQL **15.19**, the
deployed image's schema/Drizzle owner and JIT off. The separate one-GiB test VM
has no live mounts and its Coast application entrypoint is disabled.

| Comparison | Deployed Bun 1.4.3 | Tested upstream canary |
| --- | --- | --- |
| One actual 160-batch INSERT SQL shape | 160 prepared statements | 1 prepared statement |
| Eight rotated actual batch cycles, 64,000 inserted rows per trial | Backend contexts 23.4 → 145.7 MB; grows through the last cycle | 6.8 → 11.1 MB; stable from cycle 4 through 8 |
| Final backend context allocation, two schedules | 139.0 / 139.0 MiB | 10.6 / 10.6 MiB; about **92.4% lower** |
| 2,200 controlled projection shapes using genuine rows | Not repeated to exhaustion | Server statement count 1,024 after 1,100, 1,500 and 2,200 shapes |
| Ten sessions, 1,600 projection shapes each | Not deliberately run toward guest exhaustion | Every session remains at 1,024 statements; whole test cgroup about **553 MiB** |
| One-second lifetime with held reservation/transaction | Loses reservation / aborts transaction | Keeps backend and lock, completes transaction, retires expired connection after reservation release |
| Native actual JSON, complete row results and rollback | Baseline passes | Same complete hashes; passes |

MB means decimal bytes; MiB means 1,048,576 bytes. Backend context allocation,
PSS and cgroup consumption are different measurements. The 553 MiB observation
is the isolated ten-session workload, not a forecast for the full installation.

The eight-cycle test rotates actual batch boundaries to vary genuine NULL/type
patterns without inventing values. The stable experiment reached its 128-MiB
context stop threshold after the eighth completed cycle; no further growth was
forced. Each cycle checks complete ordered equality. The controlled projection
test deliberately varies selected field sets to cross the cache cap. It is a
cardinality stress schedule on actual rows, not a measured production traffic
distribution. The cap is a statement-count bound, not a byte limit on arbitrary
query plans; existing application page/batch/input budgets still matter.

Other canary checks passed:

- Actual number → text → NULL → number/text reuse of the same query shape.
- Eighty concurrent actual projections while evictions occur.
- Cancellation rejects its query while a reserved advisory lock remains held.
- A swallowed duplicate-key error cannot report its aborted transaction as
  committed; complete actual rows remain unchanged.
- Ten reserved sessions exercise separate caches; PSS is collected as the
  PostgreSQL OS user rather than summing shared-buffer RSS as private memory.

At 900 → 1,600 shapes/session, ten-backend allocation moves from 136.4 → 167.5
MB, with stable statement counts after the cap. PostgreSQL PSS reaches about
186 MiB, while client RSS is about 59 MiB. Some allocator/layout and plan-width
growth continues within the capped corpus; this is not an arbitrary-query byte
ceiling or an hours-long full-worker soak.

## Speed and alternatives

Two schedules reverse execution order and use fresh Bun processes/connections
per trial. Report warm medians per trial, retaining the complete samples:

| Work, same actual cohort | Stable, first / reversed schedule | Canary, first / reversed schedule |
| --- | --- | --- |
| Insert 8,000 rows in batches of 50, ms | 136.7 / 169.6 | 91.5 / 146.7 |
| 300 prepared fixed-array reads, ms | 52.6 / 82.1 | 53.9 / 97.6 |

Import batches are faster in both observed schedules. Fixed reads are about
2.5% and 18.9% slower respectively, with considerable between-schedule variation.
These small samples do not establish a production latency regression or parity.
They **do not support claiming improvements across the board**. Prepared reuse
is retained, avoiding the earlier unprepared candidate's parse-on-every-query
tradeoff. Mixed application CPU/latency and long-runtime acceptance are still
required.

The tested stable-runtime fallback uses one native JSON parameter with
`jsonb_populate_recordset` for full-row batches. It also levels off near **10.5
MiB**, preserves complete real rows/JSON/rollback and passes an identical-value
upsert. Its one observed warm insertion median is **52.4 ms**; prepared reads
remain around **53.3 ms**. It is promising for future import throughput, but is
not the best systemic repair: adopting it across different partial/defaulted
inserts, custom mappings, conflicts and triggers requires shared bulk-write
design and caller migration, and other query shapes would still use the old
unbounded driver cache. Its single timing schedule is not a universal speedup.

Rejected or lower-ranked paths:

- **Global unprepared switch alone:** actual native JSON fails on stable.
- **Unprepared plus codec/caller rewrite:** earlier actual-data method works,
  but changes the global JSON boundary and repeatedly reparses queries.
- **Set `maxLifetime` on stable:** actual leases and transactions fail; do not
  use this as an emergency memory setting on 1.4.3.
- **SQL-text-only cache patch:** type reuse is unsafe; do not resurrect the
  rejected upstream patch merely because its cache count is small.
- **Periodic server DEALLOCATE/DISCARD:** not adopted. A server-only reset does
  not coordinate the driver's cache; DISCARD ALL also drops advisory locks.
- **Native Bun fork or replacement DB driver:** adds ownership, distribution
  or adapter/dependency work while an upstream solution already passes the
  scoped tests. No such dependency or maintained patch was introduced.

## Concrete adoption plan and drift checks

1. Select a released Bun containing commit `017b2439…`, or explicitly review
   the exact tested prerelease binary/digest for an earlier rollout. Keep native
   JSON and prepared queries enabled; initially keep the existing zero idle/
   maximum-lifetime settings. Cache repair alone does not require another timer.
2. Update runtime inputs consistently: both Bun image references in `Dockerfile`,
   `package.json`'s packageManager/minimum engine, and the three Bun setup steps
   in `.github/workflows/verify-and-publish-preview.yml`. Local tooling and CI
   must report the intended exact revision. Do not install a rolling canary.
3. Run the repository's ordinary check/build/unit/inventory and PostgreSQL
   matrix against **current main**, plus native actual-data workflows, current
   queue claim/admission and reading/party/runtime lifecycle acceptance. This
   research imports the deployed image's older schema owner; it is not a full
   current-main application release certification. Verify both shipping CPU
   architectures; only Linux ARM64 is tested here.
4. Retain the stable-versus-candidate actual-data checks below as drift gates:
   compatible-type reuse, fixed bulk statement count, server-side eviction,
   native JSON equality, transaction failure, cancellation and lease ownership.
   Use a refreshed real fixture only with the applicable data authorization.
5. Before a rollout, use a private restore checkpoint and reviewed rollback
   procedure. Verify the **running** build/revision and image digest afterward;
   publication, merge and restart are not deployment evidence. Then record
   mixed foreground/background memory, private backend ownership, query CPU,
   latency, task throughput and recovery over a sustained workload. Do not
   declare the original freeze eliminated solely from these SQL tests.
6. Keep guest-memory failure and host stop deadlines as separate concerns. A
   persistent host recorder/watchdog remains a separately reviewed design, not
   a hidden addition to this runtime repair.

## Receipts, reproduction and retained failures

All programs refuse a database other than `coast_freeze_probe_20261021`, receive
connection settings through stdin and emit aggregate results/hashes only. Run
inside an isolated copy of the recorded image; the native schema imports use
its `/app` path. These are operator research probes, not tests for a live DB.

| Maintained program | Receipt |
| --- | --- |
| [Original protocol comparison](verify-prepared.ts) | [Canary JSON/cache comparison](canary-verification.json) |
| [Rotated actual batches/default versus recordset](verify-bulk-strategy.ts) | [Five trial schedules](bulk-strategy-verification.json) |
| [Actual reservation/transaction lifetime](verify-lifetime.ts) | [Stable failure and canary results](lifetime-verification.json) |
| [Type/eviction/concurrency/cancellation](verify-cache-bound.ts) | [Cache-bound receipt](cache-bound-verification.json) |
| [Ten-session cache/PSS measurement](verify-pool-bound.ts) | [Pool-bound receipt](pool-bound-verification.json) |

The initial bulk probe used unquoted mixed-case SQL aliases, so its host reporter
could not find the memory field. That instrumentation run is not acceptance;
quoted aliases and a finite-counter assertion were added before the retained
trials. Regular-file stdin restore transport also timed out; its disposable DB
was recreated and restored using the container file-copy API. A copied canary
initially lacked execute permission; only the isolated test file's mode changed.
No production/runtime defect is inferred from these setup failures.
The older protocol probe's descriptive `source` label says "media table only";
that label is incomplete. Its code, metadata row count and metadata hash also
cover the 32 actual `metadata_snapshots` rows. Original receipts are retained.

The [read-only live ownership follow-up](live-memory-followup.json), at 12:28 UTC,
found whole-cgroup memory about 1.88 GB, application RSS about 115 MiB and
PostgreSQL backend private anonymous memory about 38–46 MiB each. It does not
retroactively capture the frozen process state. The root driver defect is
verified; complete attribution of the original incident remains open.

The two disposable databases, extra test VM, temporary source-checkpoint copy,
compressed cohort transfers and downloaded test runtime/source files have been
removed after retaining receipts. The original approved checkpoint and earlier
private freeze evidence remain. No production settings, code, image or live task
state changed during this follow-up investigation.
