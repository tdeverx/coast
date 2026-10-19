# MIGRATION-DRIFT-OBS-04 — migration provenance and exact forward rollout

**Current result:** the approved checkpointed normal-dev 0062 + 0063 rollout ran successfully through the exact reviewed executor and plan. The [execution receipt](evidence/implementation-approved-normal-rollout.json) verifies ledger 62 → 64 with only the expected two entries, historical 0039 hash retained, two valid/ready GIN indexes, nullable toast timestamp/comment and initially null new values before the app restarted. The app now passes 815 common tests, a clean production build/typecheck/inventories/style and [signed-in inbox/reload integration](evidence/implementation-toast-normal.json). No normal successful toast write was observed because this account has no eligible toast.

The normal launcher was quiesced with process-group exit, listener release and zero other observed clients before its checkpoint. The private archive is 182,419,613 bytes, mode 600 inside a 700 directory; full pg_restore extraction passed without output. An actual restore of that specific archive was not rehearsed. The normal executor's nine observed statements/four forward DDL statements and 39.55 ms operational duration are attestation, not a performance improvement. Full 101-table/1,864,083-row equality belongs only to the separate disposable actual-data rehearsal below; normal postchecks do not inherit it.

The user explicitly approved the historical 0039 provenance uncertainty and the existing normal launcher container setting in memory only. That credential was never displayed or saved, and the running process environment was not read. The strict default preflight was not relaxed; no historical SQL or ledger hash was rewritten/replayed. Original 0039 bytes and possible data effects remain unknown. See [rollout decisions](evidence/implementation-approved-rollout-decisions.json) and [current machine record](migration-provenance.json). No commit, deployment or schema rollback was performed.

## Historical provenance and pre-adoption checkpoints

The pending-state table and unapproved/staged statements below describe the earlier read-only investigation and private rehearsal. The exact forward rollout above supersedes their normal adoption status while retaining their evidence and uncertainty.

Normal-dev migration history has an unresolved historical byte mismatch and **two pending migrations**, not only the toast column. A fresh disposable actual-data clone successfully applied exactly 0062 + 0063, preserved all existing row values and historical ledger entries, and produced only the expected checked schema changes. **Normal database adoption remains unapproved.** The strict toast preflight still fails; no historical source, ledger hash, normal schema or main application source was changed by this investigation.

[Machine-readable decision record](migration-provenance.json), [normal read-only metadata](evidence/migration-provenance-normal.json), [actual migration proof](evidence/migration-forward-actual.json), [clone cleanup receipt](evidence/migration-forward-actual-runner.json).

## What the two outstanding migrations do

| Migration | Actual normal-dev state | Exact source change | Consequence |
| --- | --- | --- | --- |
|0062_reading_detail_candidates|Absent; latest applied entry is 0061.|Two ordinary, nonconcurrent GIN indexes on `reading_works.authors` and `reading_works.subjects`.|Supports the array-overlap candidate predicate used by Related reading. Index creation can wait for/block writers; approval must include this existing pending work.|
|0063_notification_toast_suppression|Staged candidate only; column absent.|One nullable `notifications.toast_hidden_at` timestamp, no default/backfill, plus explanatory column comment.|Durable toast state; no direct dependency on reading indexes.|

0062 was introduced by `57fb2c4f66eab432d69662456e9e19869b911ab8` and merged in `77257604834621dce157e8a7068babc25d864885` before this audit's implementation. Its SQL is exactly [two index statements](/Users/admin/Documents/ChatGPT/coast-new/drizzle/0062_reading_detail_candidates.sql:1); the current [schema declarations](/Users/admin/Documents/ChatGPT/coast-new/src/lib/server/db/schema.ts:1061) agree. The [Related query](/Users/admin/Documents/ChatGPT/coast-new/src/lib/reading/detail.server.ts:25) uses same-kind filtering and `authors && candidates OR subjects && candidates`, counts/ranks overlaps, and hydrates the bounded card page. The existing full-text expression GIN index does not index either plain array-overlap expression. Normal-dev has 12 reading works, 24 KiB table storage and 112 KiB including indexes at this receipt; the planner's `reltuples=-1` is unknown, not the actual count. No query speedup or large-catalogue index-build guarantee is inferred from this small cohort.

The chronological migrator would run 0062 as well as 0063. A toast-only approval cannot silently authorize the unrelated two-index migration. Stamping 0063 first would make its later timestamp hide 0062 from this migrator, so that is not an acceptable shortcut.

## 0039: compatible checked objects, unknown original SQL bytes

The ledger stores 0039 SHA-256 `66f067bdf6014c26e11d305157889ca3a1712fead2d105dbd63b696511b4438e`; current source is `46c40ee9cd4c53adecd1a68a1df1c11afc2055bd888c4281d1a840750eef7cc2`. Reachable `git log --all --follow` contains one file-history introduction, `d6bb435d473968435eb9d09b7ccd36f5eb61af06`, whose bytes exactly match current source. Tested newline/CRLF and final sync-account-trigger-tail variants do not match the applied hash. These limited checks do not exhaust possible former files. The original applied bytes were **not recovered**; a hash cannot reconstruct them.

Current [0039 source](/Users/admin/Documents/ChatGPT/coast-new/drizzle/0039_performance_benchmarks.sql:1) creates the benchmark/revision tables, constraints, indexes, functions and triggers. Its top-level statements are DDL; writes shown inside the function bodies are defined behavior, not a top-level backfill. That observation says nothing about additional statements or data effects in the unknown historically applied bytes.

A credential-free normal-dev local-socket transaction used `BEGIN READ ONLY`, explicit 5s statement / 1s lock limits and rollback. It established the following bounded current compatibility:

- All three revision function bodies match source byte for byte. Signatures, return types, language, security-invoker/strict/volatility/parallel/configuration/set/leakproof attributes match the current source defaults.
- All 118 original triggers are present and enabled. Function targets, tables, event/row flags, arguments, transition-table aliases, lack of WHEN/UPDATE-OF filters and deferral match. 18 additional current revision triggers are accounted for by already-applied 0042/0047/0060 and pass the same checks; they are not unexplained 0039 drift.
- The 17 columns and 7 constraints across the three 0039 tables were manually crosschecked against source. All four benchmark indexes are valid/ready and their definitions agree.

This is current-object compatibility evidence, **not recovered migration provenance or exhaustive schema equivalence**. Ownership, ACLs, execution costs and every catalog dependency were not attested. Unknown historical data effects cannot be ruled out by comparing current schema. Never rewrite 0039's source or ledger hash to manufacture a matching prefix, and never replay its historical DDL over existing objects.

## The ordinary migrator does not enforce historical hashes

The current [migration entry point](/Users/admin/Documents/ChatGPT/coast-new/scripts/migrate.ts:15) invokes installed Drizzle directly. Its pinned `pg-core/dialect.js:44–78` selects only the latest ledger row, then applies source migrations whose journal timestamp is newer. It does **not** compare historical hashes or require a complete applied prefix. It creates schema/ledger metadata with `IF NOT EXISTS` before the migration transaction. The two pending migrations and their ledger inserts then share one transaction.

The installed file reader hashes each local SQL file, but that hash is only inserted for a newly applied entry. [Runtime migration fingerprints](/Users/admin/Documents/ChatGPT/coast-new/scripts/runtime-audit.ts:64) are audit logging, not an integrity gate. Thus calling ordinary `migrate` would ignore the 0039 mismatch and apply0062+0063; it is not a safe read-only preflight. The existing strict staged preflight correctly remains closed.

## Actual forward rehearsal

The [executed probe](probes/migration-forward-actual.ts) ran the exact installed Drizzle migrator on a newly generated `coast_audit_migration_actual_*` database copied from the existing actual-data fix clone. The [runner](probes/migration-forward-run.py) checked the base clone was idle, created only the generated target, kept the existing approved test-container credential in memory and finally dropped only that new clone. Normal and the original fix clone were not migration targets. There were no fabricated catalogue rows.

Before migration, the probe required exactly 62 applied entries, the sole exact known 0039 hash mismatch, only 0062 + 0063 pending, absent candidate indexes/column, exact reviewed SQL/journal hashes and the approved loopback endpoint. A single-connection pool explicitly established 30s statement / 5s lock limits; matching private backend PIDs before migration and after all verification confirmed the same physical session. No credential, backend PID or private row identifier is retained in published evidence.

The retained result is:

- 62→64 ledger rows: exactly the expected 0062 and 0063 source hashes/timestamps were appended. All previous 62 rows, including 0039, remained exact.
- Two valid/ready GIN indexes and one nullable timestamp/comment appeared. No other relation, table-column, index, constraint, trigger or function delta occurred in the checked public/Drizzle catalog projections. Exactly the four source forward-DDL statements were observed; existing schema/ledger `IF NOT EXISTS` statements were no-ops.
- SHA-256 sorted row-value multisets matched across 101 existing tables and 1,864,083 rows, including 12 reading works and 518 notifications. The newly added nullable field was excluded from comparison; every value of that field was separately confirmed null. This compares logical values, not physical tuple locations. Ledger rows were checked separately.
- A second actual migrator call issued only its three metadata statements and changed no row values, checked schema or ledger entry.
- The disposable clone was dropped after pool closure. No normal migration or application adoption occurred.

The migration itself took 50.3 ms in this quiet small-reading-table snapshot; the no-op call took 6.9 ms. These are operational rehearsal timings, not performance savings or lock-contention estimates for another installation. This proof does not recover 0039's original bytes, compare all ownership/ACL catalog state, test concurrent normal traffic, or replace the staged toast's application/browser acceptance.

The retained probes are exact executed review artifacts for this local checkout/private staging arrangement, not a general production rollout CLI. Their absolute module/stage paths and approved clone-name file are intentional source pins. The normal metadata probe accepts repository/output paths; it uses only the existing local socket and a read-only transaction. Future adaptation requires reviewing path/target/source guards; never point the mutation probe at normal.

## Reviewed options and proposed approval scope

1. **Recover historical provenance first.** Obtain original 0039 SQL from an existing prior build or backup and compare it. No such bytes were found in reachable Git history. This avoids accepting the remaining provenance gap, but delays toast adoption.
2. **Explicitly accept this target's historical gap and move forward with both migrations.** Preserve original 0039 source/ledger, record the exact accepted applied/source hash pair and bounded current compatibility, and approve 0062's two indexes plus 0063's nullable column/comment. The actual-data rehearsal supports this narrow path. It is a specific reviewed decision, not a generic compatibility shim or relaxed default preflight.
3. **Keep toast staged.** If the historical gap or reading-index scope is not accepted, make no normal change. Do not stamp/reorder pending history or mark indexes applied without creating them.

For option 2, approval must explicitly cover the unresolved 0039 original-byte/data-effect uncertainty, the two existing 0062 index builds, and 0063's additive toast schema. Before execution, recheck the exact target, all 64 source pins, ordered 62-entry ledger, exact single accepted mismatch, pending set and current index/column state; take an agreed restore checkpoint; coordinate one migrator with verified connection-level limits. Reject any different drift or pending work. Afterward verify exactly two new ledger rows, historical 0039 unchanged, exact valid/ready indexes, nullable column/comment and unchanged existing values. Then run the staged toast's application gates and signed-in normal-dev browser acceptance. This report authorizes none of those normal mutations.

A later shared maintenance change can make prefix/hash verification a default prerequisite to any migration, with explicit reporting of this separately accepted historical record. That is a plan, not an implemented bypass. Keep the strict preflight failure visible until the user chooses a path. A failed forward transaction rolls back its new changes; application rollback after a successful additive rollout should retain the new column/ledger, since dropping them would erase durable toast state and requires a separate decision.

## Prepared normal executor, not run

The [target-specific rollout artifact](probes/migration-rollout-0062-0063.ts) uses the existing installed Drizzle migration owner and the [exact reviewed plan](candidates/migration/rollout-plan.json). It does not discover credentials. Source-only `--verify-plan` passed without connecting to a database; [receipt](evidence/migration-rollout-plan-verification.json). The actual normal migration branch has **not** been entered and is not represented as browser/application acceptance. An explicit `NOT_APPROVED` negative control with the apply flag [failed before any database connection](evidence/migration-rollout-no-approval.json), as required.

Its checks pin all64 migration files, journal and installed migrator bytes; require127.0.0.1:55432/database `coast`; verify the exact62-entry ordered hash/timestamp prefix including the explicitly accepted0039 pair; admit only0062+0063; reject partially present candidate indexes/column; verify30s/5s limits and the same physical backend; and use only the unchanged migration owner. Postchecks require the exact two-entry ledger append, historical 0039 intact, exact valid/ready GIN definitions, nullable timestamp/comment with all initial values null, and the exact9 observed statements/four forward-DDL statements. Any uncertain migration attempt requires read-only reconciliation, never an automatic retry.

The apply branch additionally requires explicit operator markers for the human-approved scope, restore checkpoint and coordinated single migrator. Markers do not themselves constitute user approval or prove operational exclusivity: the existing ordinary migrator has no universal concurrency fence, so coordinating other launchers remains a prerequisite. The root agent may use the existing configured launcher environment in memory after approval. No new credential may be discovered/copied from container settings for normal adoption. Current shell's missing `DATABASE_URL` is a fail-closed condition, not a reason to infer or print one.

Only this source verification is currently authorized and executed:

```sh
.tools/bun-1.4.3/bun-darwin-aarch64/bun docs/audits/2026-10-17-app-performance/probes/migration-rollout-0062-0063.ts --verify-plan
```

The mutation branch is deliberately omitted from operator instructions until explicit approval of the stated scope. Re-run source verification immediately before any approved apply; changed source, target, ledger, runtime or pending state requires review.

Independent read-only review approved the exact executor SHA-256 `7753f23d74aaa08436d0665b29b65c66e05dfc53fcc42770282d3d370dd54675` and plan `2e7572e8df4de57b378a08003e4982c905e893d1576d4aa344bfac5fba4c5c83`, with no material blocker. The normal executor verifies ledger/schema/new nulls; it does not claim the private rehearsal's full-table multiset comparison for normal data. Its nine-statement comparison is postexecution attestation, not a precommit SQL firewall. Exact source/runtime pins and frozen-stage/single-migrator prerequisites provide admission. Human approval of normal execution and the historical uncertainty remains pending. All owned writes are frozen after this review record.
