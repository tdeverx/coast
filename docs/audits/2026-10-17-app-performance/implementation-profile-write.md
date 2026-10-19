# DATA-07 — avoid rewriting identical profile settings

The final shared profile writer now updates users.settings only when the computed JSONB value differs. All validation, the locked user snapshot, every returned profile field and the GIF store/prune lifecycle remain in their original order. This implements only the profile slice of DATA-07; metadata, games, list and queue opportunities remain separate.

[Machine record](implementation-profile-write.json), [actual rollback proof](evidence/implementation-profile-write-actual.json), [exact probe](probes/profile-write-actual.ts), [original writer](candidates/profile-write/service.before.ts.txt), [guarded test receipt](evidence/implementation-profile-write-tests.json).

## Shared contract and trigger review

[updateProfile](../../../src/lib/core/profile/service.server.ts:34) still validates the complete command, locks and reads its user, applies the same edit/preference/feature/background/pin/order rules and returns the computed profile. Its [final UPDATE](../../../src/lib/core/profile/service.server.ts:133) adds a parameterized, null-safe IS DISTINCT FROM predicate. Because it uses the complete settings object rebuilt from that locked row, unrelated settings are preserved. There is no early-return bypass of feature/favourite validation or avatar cleanup. Same-value edits still call pruneGifAvatars after the application transaction, and inline GIFs still use the original storage owner before writing settings.

Source migrations define one non-internal users UPDATE trigger. The actual clone also has exactly that enabled AFTER STATEMENT trigger, users_content_update; its function body and language/volatility/security/configuration attributes match the reviewed current source. The other 52 UPDATE triggers are PostgreSQL RI_FKey_noaction_upd constraints. Settings writes do not change their referenced user key. The revision function already excludes identical OLD/NEW row values with EXCEPT. An UPDATE matching zero rows still invokes the statement trigger with empty transition sets; no required unconditional user-row side effect was found. This is a bounded current-schema check, not permission to assume future triggers have the same contract.

## Actual saved-value proof

The exact pre-change and current production functions used the same source-pinned dependencies and actual existing users/settings. All calls ran in rollback-only transactions on the approved private clone, with explicit verified 30-second statement/5-second lock limits. Metadata and whole-table snapshots ran read-only. No catalogue, user or performance fixture was inserted, and no normal database was touched.

Twelve complete comparisons passed. Nine actual saved-value no-ops cover two preference saves, one explicit saved background mode, two saved positions and four saved edits. Baseline calls each affected one user row and replaced its tuple; the current predicate affects zero rows and retains ctid. Complete returned profiles, complete resulting user rows and owner/global revision values match exactly. The actual Bun/Drizzle plain-object JSONB bind therefore exercises the guarded predicate rather than only compiling its SQL.

Three genuine-change controls use a valid background-mode value already persisted on another actual owner, then roll back. Both versions update one row and produce identical full profile/user/revision results. These are controlled correctness changes using existing valid values, not observed normal workload frequency or fabricated performance cohorts. Four edit comparisons retain one prune call each. No actual GIF data-URL storage replay occurred; its unchanged code is source-reviewed. The probe's private data directory contains no normal avatar files.

Before/after logical multiset hashes match for **all 102 tables / 1,864,145 existing rows**. The pool closed and every domain mutation rolled back. This proves live row values were restored; rolled-back PostgreSQL work can still generate WAL/dead tuples, so physical database files are not claimed byte-identical.

The probe injects application transaction callbacks into an outer rollback transaction. Thus pruning runs under the same held row fence for isolation, rather than testing the normal post-commit second-transaction race. Complete values, tuple admission and lifecycle call counts are verified; no new concurrency proof is claimed.

## Costs, tests and remaining work

The predicate still sends one UPDATE statement and retains the SELECT FOR UPDATE. Ordinary profile calls remain two counted ORM statements; edits remain three because pruning keeps its locked reread. The comparison also binds the settings value a second time and performs a JSONB comparison. Avatar/settings bytes therefore remain an input cost. The observed gain is removal of identical tuple writes, not fewer statements, network payloads or content revisions. Single before/after timings are descriptive; no general latency, WAL, CPU or memory gain is claimed.

A new guarded [database regression](../../../tests/profile-db.test.ts:104) checks identical preferences preserve tuple/settings/revisions while a changed preference writes and returns normally, restoring fixture settings in finally. The non-database invocation reported 0 pass /22 guarded skips /0 failures; it parses/discovers the test, but does not claim that fixture suite executed. The actual production-function probe supplies this pass's executed saved-data proof. Root owns the separate full gates and normal-dev acceptance.

Independent exact-source review found no material issue in parameter binding, row locking, validation, unrelated settings preservation or avatar lifecycle; the actual bind/trigger proof is retained separately. Application/test source is frozen at the hashes in the machine record.

Do not extend this mechanically to work_features. The current taste reader resolves per-dimension values by updated_at descending and provider. Suppressing an unchanged provider timestamp can alter precedence against another provider; that needs an explicit freshness/precedence contract. The existing reading feature guard does not prove every writer may adopt it without further review.
