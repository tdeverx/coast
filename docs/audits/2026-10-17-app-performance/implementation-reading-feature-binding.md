# Reading feature parameter reuse

`importReading` now reuses the inserted generated features in both conflict `SET` and the existing distinctness predicate. This removes two native JSON object bindings per feature upsert while preserving the no-op guard and both independently sampled timestamps. The exact two-expression candidate was adopted only after the complete actual-data rollback proof passed and root approved it. No schema, dependency, UI, provider policy or structural early return was added. [Machine-readable report and pins](implementation-reading-feature-binding.json).

## Shared owner and preserved contracts

The only application edit is [the feature upsert](/Users/admin/Documents/ChatGPT/coast-new/src/lib/catalogue/reading.server.ts:70): conflict `features` now uses `excluded.features`; the comparison remains `work_features.features is distinct from excluded.features`. Both INSERT and conflict-update `new Date()` calls remain separate source expressions. Always-generated genres/tags/writers and optional franchise features are unchanged, including empty arrays and named-feature normalization. An unchanged observation still enters the owner, takes its identity locks, verifies saved identities and evaluates the existing feature no-op predicate.

All reading ingestion consumers share this owner: [explicit Add reading](/Users/admin/Documents/ChatGPT/coast-new/src/lib/application/reading.server.ts:17), [lazy issue-group metadata enrichment](/Users/admin/Documents/ChatGPT/coast-new/src/lib/reading/groups.server.ts:24), and [Jellyfin exact-identity metadata hydration](/Users/admin/Documents/ChatGPT/coast-new/src/lib/sync/jellyfin-reading.server.ts:32). Their provider requests, user/account access checks, file observations, scan/reset fences and private reading-state writes remain outside this edit. No consumer-specific feature writer or cache was introduced.

Upfront strict metadata validation and enabled-category/config admission, sorted provider-identity advisory locks, conflict detection, work UUIDs, alternate-source fill-only behavior, book-to-comic upgrades, identifier verification, optional group/membership reconciliation, complete returns and revision behavior remain unchanged. The two replacement expressions do not skip any of those paths or infer structural completeness from equal features.

## Actual input provenance

The [read-only census](evidence/implementation-reading-feature-binding-census.json) found **twelve Comic Vine comics and zero books**. Each has authors and series metadata; none has subjects or page count. The stored provider-item snapshots contain only title/format/version, and edition metadata only version/identity-conflict bookkeeping. Neither family contains a strict `ReadingMetadata` input, and no linked metadata-snapshot raw object exists. These files do not establish a retained provider request.

The proof therefore uses **twelve actual canonical single `reading_works` row projections, not captured provider inputs**. It retains exactly each row's identity/title/source/authors/subjects/edition IDs and non-null optional metadata, omits null optional fields, and adds no aliases, groups or credits from other tables. All twelve pass the actual strict schema with identical normalized output. Their generated feature objects match all twelve saved feature rows: nonempty writers/franchises, empty genre/tag dimensions, total serialized JSON representation 2,688 bytes. The two existing groups and twelve memberships are retained-state checks; the proof does not claim execution of a supplied-group import.

The [exact census source](evidence/implementation-reading-feature-binding-census-probe.ts.txt) is retained. It ran READ ONLY / repeatable read with explicit verified ten-second statement and one-second lock budgets, rolled back and closed its pool. Raw row values, IDs, titles and URLs remain private memory; only aggregate counts/digests are retained.

## Complete before/current rollback proof

The [actual receipt](evidence/implementation-reading-feature-binding-actual.json) runs both complete `importReading` owners over the same twelve canonical projections, using actual dependencies and the installed native Bun JSONB codec. Complete returned rows, all-table post-state, revisions, DML admission and tuple-change counts match. The existing no-op behavior is preserved: no canonical work, reading-work, identifier, feature, group or member tuple changes; neither identifier INSERT attempts nor guarded feature upserts affect a row.

| Actual compiled-owner boundary | Before | Adopted expression |
| --- | ---: | ---: |
| Native generated-feature parameters | 36 | 12 |
| Feature JSON parameter-size proxy | 8,064 bytes | 2,688 bytes |
| Total bound parameters | 204 | 180 |
| All-parameter JSON-array size proxy | 11,844 bytes | 6,444 bytes |
| ORM statement executions | 72 | 72 |
| Logical owner transaction calls | 12 | 12 |
| Schema / enabled-category admissions | 12 / 12 | 12 / 12 |
| Independently evaluated feature-clock samples | 24 | 24 |
| Identifier / feature DML attempts | 12 / 12 | 12 / 12 |
| Identifier / feature affected rows | 0 / 0 | 0 / 0 |

Binding multiplicity is counted from the actual compiled owner calls. Byte figures are **`JSON.stringify(native parameter)` UTF8 representation proxies**, not measured PostgreSQL wire bytes, Bun encoding work, CPU or allocation. The JSON-array proxy includes other parameters and JSON syntax. Raw config and capture SQL are outside the ORM metric. This change establishes fewer repeated bindings, with no measured latency, memory, WAL, statement, transaction, round-trip or physical-write saving.

Metadata/initial/final snapshots use READ ONLY transactions; owner cases have explicit verified thirty-second statement/five-second lock budgets. The owner still performs its actual pretransaction config read. A bounded two-connection pool leaves one connection for that unchanged read while the outer rollback holds the other. The spare config connection receives constructor options, but its budget is not independently verified, and config plus owner reads are not claimed to share one database snapshot.

Each original owner transaction uses a real nested savepoint within an outer rollback. Private module clock samples call fresh `Date` objects at one shared instant for state equality; dependencies are unchanged. This preserves the number of evaluated source samples but does not establish normal clock freshness, per-item commits, lock-release schedules, cancellation/revocation races or concurrent provider imports. The focused driver test below separately protects the distinction between the two timestamp values.

Actual content-revision trigger body matches reviewed source. Full post-state is also identical to initial state for this no-op corpus. All **102 tables / 1,864,145 row values**, migration-ledger values and sequences restore exactly after rollback; zero external calls, unchanged source pins, pool closed. This is logical restoration, not proof of zero physical WAL/dead tuples. Only the approved private clone was used; normal/deployed installations, provider secrets and reading files were not accessed or changed. The existing private-clone database credential remains inside the previously approved runner's memory.

## Regression and review

[Focused test receipt](evidence/implementation-reading-feature-binding-tests.txt): **one test passed, zero failed, fourteen assertions**. The [source-derived driver contract](/Users/admin/Documents/ChatGPT/coast-new/tests/reading-feature-binding.test.ts) compiles the real upsert with the installed Drizzle dialect/schema/native codec. Empty and nonempty Unicode authored cases retain one identical native features object, the existing distinct predicate, and two distinct timestamp parameters from separate clock samples. These are supplemental driver controls, not fabricated actual catalogue cohorts or database performance measurements. No fake provider or database response is used.

The provider/jobs agent independently reviewed the private proof's guards, input provenance, rollback ownership and metric limits with no material blocker. The same agent then read-only approved the exact adopted source and focused driver contract. Root reviewed the successful actual receipt and approved only the exact two-expression candidate. The retained baseline is `72d42f74…`; current source is byte-identical to verified candidate `5d677f50…`. No extra database rerun was needed after exact adoption. Common gates, source inventory and normal-browser acceptance remain root-owned and are not claimed by this focused receipt.

## Reproduction and remaining gaps

The [exact executed proof](evidence/implementation-reading-feature-binding-executed-probe.ts.txt), [baseline](candidates/reading-feature-binding/reading.before.ts.txt) and [candidate](candidates/reading-feature-binding/reading.candidate.ts.txt) were retained before application. The historical receipt's `productionStillBaseline=true` is correct for that pre-adoption run and is not repointed to current source. The [portable replay](probes/reading-feature-binding-real.ts) changes only retained paths, adopted-source guards and their labels. It was [syntax-checked](evidence/implementation-reading-feature-binding-portable-syntax.txt), not rerun against a database. Any future run needs a separately authorized strict designated clone plus `COAST_AUDIT_READING_FEATURE_ROLLBACK=1`, current source/data review and a new receipt; never use normal/deployed targets.

There is no positive actual book, changed/new feature, new-work, alias-conflict, supplied-group or upgrade input in this proof. Their original code remains unchanged; the authored driver controls do not fill those actual-data gaps. Provider network, fresh metadata, per-item commit concurrency and browser resource use were not exercised. The original larger reading/import lifecycle and persistence options remain separate work; this exact shared-owner parameter repair does not claim to complete them.

Current combined gates:791pass/710guardedskip/0fail/33,722assertions across1,501tests/279files; typecheck0errors/0warnings; build/inventories/style passed. The [frozen authenticated normal5173 trial](evidence/implementation-ancestor-material-normal.json) passed account/nested/task/movie/comic menus, Library120media links/28completedimages, Read12actualcomics, Continue34links/13completedimages, Admin and final30pausedTasks, with0dialogs/0popovers/0newwarnings/errors and unchangedsource. Open menus usednativeglass; closedmenuowner markers were0 and the originalaccountfilter wasremoved. CustommediaEnteropens, whileArrowDowndidnot; sharedaccountArrowDown/nestedArrowRight/Escape passed. No mutationcommand was submitted, and no liveingestion/helperwrite/CPU/heap/GPU/network/touch/longsoak claim is made.
