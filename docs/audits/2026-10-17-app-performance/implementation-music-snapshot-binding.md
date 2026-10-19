# Music snapshot parameter reuse

The smallest binding slice of `PR-05` is implemented in `persistMusic`. Its provider-item upsert now uses `excluded.snapshot` for the conflict update, reusing the snapshot already supplied to INSERT. This removes one native JSON parameter per upsert. Last-seen timestamps, per-item transactions, all metadata/edition/artist/member reconciliation and account access checks remain intact. The broader serial persistence and per-source page-growth concern remains open.

The exact one-expression candidate was adopted after complete retained-data rollback comparisons passed. No dependency, schema, UI, provider policy, structural early return or normal/deployed database mutation was introduced. [Machine-readable report and source pins](implementation-music-snapshot-binding.json).

## Existing owner and unchanged behavior

`src/lib/music/persistence.server.ts:49` changes only conflict `SET snapshot` from a second snapshot parameter to the existing INSERT value. Both calls to `new Date()` remain: the INSERT observation and conflict-update observation retain their original independent timing. Required provider `lastSeenAt` and personal access `verifiedAt` writes are preserved.

Every album/track observation uses this canonical owner: interactive music source browse, source detail/child rows, favourite preparation, missing-metadata user scan hydration, library bootstrap/full scans and change-hint music observations. Artist-only persistence has a separate branch and is unchanged. The shared access owner still refreshes an admitted page under feature/policy, user, connected/enabled source and account-generation fences; active job lease/reset checks remain unchanged.

Jellyfin ID normalization, per-item and verified MusicBrainz advisory locks, conflict/identity checks, selected editions, occurrence positions, artist attribution and release membership repair all remain. No snapshot-equality early return was added: an unchanged provider snapshot alone cannot prove that credits, another source's canonical values or selected-release membership need no reconciliation.

The existing canonical work/edition/member no-op guards already avoid physical changes in the actual unchanged corpus. The change does not claim fewer SQL statements, transactions, tuple replacements, round trips or revisions. It does not address the fifty cards per selected source, aggregate source growth, serial artist/credit work or album membership reads.

## Actual retained corpus and typed census

The [corrected read-only census](evidence/implementation-music-snapshot-binding-census-v2.json) found **959 exact current shared snapshots: 162 albums and 797 tracks**, one instance, 959 editions, 28 artists, 1,934 credits and 797 projected album membership edges. Two connected owners have 1,918 available music rows. No actual track has multiple editions in this snapshot.

All 959 stored snapshots match the current `musicMetadataSnapshot` projection and contain no personal/presentation fields. They are real retained `MusicItem` projections, not a captured current provider page or a new provider response. PostgreSQL assignment-typed comparison of the existing canonical tuple matches all 959 rows. The work guard admits **zero** canonical metadata updates. No snapshot-omitted release date/year/duration/overview has a non-null stored canonical value; the sparse-field observation edge therefore has no positive actual cohort here. That edge is not a verified runtime defect or gain and was not changed.

An [earlier read-only census](evidence/implementation-music-snapshot-binding-census-v1.json) incorrectly compared `Math.fround` values with PostgreSQL's decimal JSON rendering of `real`. Its speculative `940` update/change counters are **invalid** and must not be used. The valid inventory/shape/missing-field counts are separately reproduced by the corrected census. The typed comparison uses actual `::real`, date and integer assignment semantics and the effective omitted-field SET behavior; its result supersedes the JavaScript counters. Both [original](evidence/implementation-music-snapshot-binding-census-v1-probe.ts.txt) and [corrected executed](evidence/implementation-music-snapshot-binding-census-v2-probe.ts.txt) source texts remain retained.

## Complete before/current rollback proof

The [actual proof](evidence/implementation-music-snapshot-binding-actual.json) executes both complete owners against the same retained input and canonical dependencies. It covers the entire 959-snapshot corpus and two existing connected-owner access cohorts of fifty already-available default-source items each. These fifty-item cohorts are selected existing records, not claimed captured browse pages. Full returned objects, all-table post-state, all 162 ordered album member/occurrence arrays, DML admission and tuple-change counts match for all three cases.

| Observed boundary | Before | Adopted expression |
| --- | ---: | ---: |
| Full-corpus native snapshot parameters | 1,918 | 959 |
| Full-corpus JSON parameter-size proxy | 1,829,114 bytes | 914,557 bytes |
| Full-corpus total bound parameters | 54,333 | 53,374 |
| Full-corpus ORM statements | 13,136 | 13,136 |
| Full-corpus logical owner transaction calls | 959 | 959 |
| Full-corpus provider-item tuple changes | 959 | 959 |
| Full-corpus canonical work / edition tuple changes | 0 / 0 | 0 / 0 |
| Each fifty-item access cohort: native snapshot parameters | 100 | 50 |
| Each fifty-item access cohort: JSON parameter-size proxy | 93,594 bytes | 46,797 bytes |
| Each fifty-item access cohort: ORM statements / logical transactions | 701 / 51 | 701 / 51 |
| Each fifty-item access cohort: access rows updated | 50 | 50 |

Native binding multiplicity is counted from actual compiled owner calls. The byte columns are **`JSON.stringify(native parameter)` serialized JSON size proxies**, not measured PostgreSQL wire bytes, Bun driver encoding work, CPU or allocation. Across all ORM parameter arrays, the serialized JSON-array proxy falls 3,394,535 → 2,479,019 bytes for the full corpus and 186,589 → 139,742 for each access cohort. That representation includes other parameters and JSON syntax; it is not network traffic.

The full run preserves the necessary 959 provider freshness writes, 1,933 credit INSERT attempts that affect zero rows, 956 identifier INSERT attempts that affect zero rows, and existing canonical no-op checks. Access cohorts preserve both metadata observations and their one fifty-row availability upsert. This is parameter reuse, with no measured latency, WAL, heap, response-size or transaction/write-count saving.

The clone guard, explicit execution opt-in and local thirty-second statement/five-second lock limits were verified. Metadata/initial/final snapshots use READ ONLY transactions. Mutation cases run inside outer rollback transactions; each original owner transaction call becomes a real nested savepoint. A shared fixed clock applies only to the private music modules' `new Date()` calls so required observation values compare exactly. This extends lock lifetimes until outer rollback and does **not** prove normal per-item commit timing, cancellation/reconnect races or production concurrency. Active job-lease failure and changed-provider-field/repeated-release cohorts remain separate gaps.

All 102 tables / **1,864,145 row values**, migration ledger and sequence values restore exactly. Actual content-revision trigger body matches reviewed source. External fetch attempts were zero, source dependency pins stayed unchanged, and the pool closed. No provider transport, key/credential decryption, normal database or actual source-library mutation occurred. Rollback does not mean zero physical WAL or dead tuples. Only aggregate counts/digests are retained; snapshots, IDs, SQL parameters and complete DTOs stay private in memory.

## Harness correction and regression coverage

The [first proof attempt](evidence/implementation-music-snapshot-binding-failed-1.json) stopped at its binding assertion before executing the first provider-item upsert. It assumed the generic Drizzle JSON-string codec. This project instead uses the [native Bun JSONB codec](/Users/admin/Documents/ChatGPT/coast-new/src/lib/server/db/jsonb.ts), which passes snapshot objects through to Bun. Its failed outer transaction rolled back and its pool closed; no equality or byte result was claimed. The [exact failed source](evidence/implementation-music-snapshot-binding-failed-1-probe.ts.txt) remains immutable. The corrected proof pins that codec and counts native objects rather than generic JSON strings.

[Focused regression receipt](evidence/implementation-music-snapshot-binding-tests.txt): **twelve tests passed / zero failed / 77 assertions** across the new real-statement compilation regression and eleven existing Jellyfin music adapter tests. The new test compiles the actual source statement using the installed dialect/schema/native codec, with no database or mocked runtime persistence. Nested/Unicode JSON remains one native snapshot object, and both distinct observation timestamps remain bound. It is supplemental driver-contract protection; the complete actual-data proof is primary. Existing guarded database music tests were not run on actual data as fabricated fixtures.

The provider/jobs agent independently reviewed the private proof's guards, ownership and limitations. Root reviewed the successful proof and approved only the exact one-expression candidate. Root reports current combined gates passed: 787 tests, zero failures, 708 guarded skips, 33,642 assertions; check zero errors/warnings and production build/inventories passed. The [source-frozen normal UI trial](evidence/implementation-shared-admission-normal.json) passed Library/Listen→1989 detail→settled Back102links and final30Tasks with no new warnings/errors or source drift. It does not execute a live provider-page refresh.

## Reproduction and remaining work

The [exact executed proof](evidence/implementation-music-snapshot-binding-executed-probe.ts.txt) preserves the pre-adoption paths/guard. The [portable replay](probes/music-snapshot-binding-real.ts) reads the [retained baseline](candidates/music-snapshot-binding/persistence.before.ts.txt) and pins the adopted current owner; its path/production guard and proxy labels are adapted for replay. The [portable typed census](probes/music-persistence-census.ts) similarly pins the adopted owner. Both portable forms were syntax-checked, not rerun against the database after adoption. A future rollback replay requires a separately authorized designated clone and `COAST_AUDIT_MUSIC_ROLLBACK=1`; never point it at normal/deployed installations. Preserve new receipts after source/data changes rather than relabelling this evidence.

The larger original options remain: measure bounded page persistence with deterministic lock order and explicit failure/commit scope; batch only authoritative artist/credit/release work without skipping repair; or deliberately agree a selected-source/merged pagination contract. Current full release occurrences, account freshness, source ordering and completeness cannot be traded away silently. The retained corpus now supplies a meaningful unchanged baseline, but live provider-page/cold-path/change/cancellation/reconnect and multi-edition acceptance are still needed before that larger refactor.
