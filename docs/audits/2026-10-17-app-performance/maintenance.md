# Maintaining this audit and preventing drift

The [implementation ledger](implementation-ledger.md) and its 94-record counts describe the historical 19 October epoch. Later task, reader and browsing changes supersede some open descriptions. Start with the [22 October follow-up register](../2026-10-22-performance-followup/README.md) and its exact acceptance/rejected-trial records, then the [future checklist](next-investigation-checklist.md). Historical receipts are immutable evidence, not a current completion scoreboard.

## Checks for an implementation change

Use the exact runtime selected by `package.json`, Dockerfile and CI: **Bun 1.4.4-canary.1+6bb5dc195**. Put that runtime on `PATH` and verify its revision. CI extracts it from the immutable image pinned in Dockerfile. A newer research canary, a system Bun and an older 1.4.3 runtime are different measurement environments; label supplementary runs accordingly.

```sh
test "$(bun --revision)" = "1.4.4-canary.1+6bb5dc195"
bun test tests
bun run check
bun run build
bun run code:inventory
bun run ui:inventory:check
bun run code:style
```

The approved navigation repair also has `bun run navigation:check`. The build invokes it, and a clean frozen installation must reproduce the exact patched installed owner. Its maintained checks bind the Kit version, manifest registration, patch bytes and installed client. Review the patch and rerun its schedules when upgrading Kit; changing the expected hash alone is not verification. The [navigation report](implementation-navigation.md) retains clean full and production installation evidence and the scope of its controlled schedules.

Run focused tests while developing a change. Once the final source passes the complete appropriate batch, repeat it when source changes, a failure occurs or a material concern remains. Guarded skips remain skips. Controlled clocks, transports and faults protect behavior; their inputs do not establish actual catalogue performance.

## Actual-data verification

Use a designated private clone of the retained catalogue for mutation, DDL, fault and concurrency experiments. Never redirect a clone probe to normal development or production. The retained probes deliberately pin targets, source, dependencies and workload; their absolute paths are review artifacts, not a general rollout interface.

For each proposed query or projection change:

1. Record the actual cohort and its provenance, including absent families. Keep identifiers, raw records, credentials and query parameters out of published aggregates.
2. Freeze the exact baseline, candidate, patch and probe. Review the output contract before executing it.
3. Establish and verify transaction mode, isolation, statement/lock limits and the physical backend. A connection environment option alone is insufficient evidence.
4. Compare complete public outputs and ordering. Check occurrence, grouping, privacy, missing-row, cursor and fallback behavior where the actual cohort permits it. Preserve missing cohorts explicitly.
5. Capture whole-plan buffer and temporary counters. Inclusive plan-node counters cannot be added into a total; shared reads do not prove physical disk reads. Keep adverse cases and timing outliers.
6. Roll back and close every pool. A write experiment must attest logical values, revisions, sequences and candidate-schema cleanup to its stated scope. Logical restoration does not restore physical tuple layout, cache, WAL or visibility state.
7. Preserve failed runs separately. Fixing a harness or narrowing a classifier requires a new receipt and an explicit boundary; it cannot turn the earlier failure into a pass.

No fabricated catalogue, provider metadata, missing media family or synthetic large account may substitute for the requested actual-data evidence. Authored controls can supplement a natural gap and must be labeled accordingly.

When a canonical owner opens its own transaction, a reserved connection and matching backend alone do not establish a shared snapshot. Bind a native outer transaction, disclose any nested savepoint adapter, and verify transaction identity and settings before and after each owner. Restore transaction-local settings that would otherwise survive savepoint release. Keep harness control queries separate from application read counts.

## Signed-in UI acceptance

Use the normal development application at `http://localhost:5173`, with the existing signed-in browser session. Public browsing, a private clone's UI and an earlier deployed build are separate environments. Verify rendered signed-in content before attributing a result to authenticated normal development.

Freeze source across each journey. Exercise the affected owner through its real callers, then verify teardown and console state. Useful repeated journeys include detail open/full/Back/close, an expanded panel at scroll-top receiving the reverse wheel gesture, Library append and refresh, reader minimize/resume/close, nested menus, and Tasks polling with an overlay present. Preserve the existing appearance and interaction design.

DOM removal, a correct image or a clean console establishes only its observed behavior. CPU, heap, GPU, decoding, network transfer and long-session retention require separate measurements. Keep automatic freshness, session and presence side effects visible in the boundary even when no mutation command is submitted. A loading deadline or detached control is recorded as such; a later successful journey does not erase it.

For native event checks, ancestor capture is not target-handler completion, and Svelte tick does not establish delivery of the remaining event listeners. Identify each triggering operation and native event separately; require its target observation and a later task before asserting that no duplicate callback occurred. An earlier held event cannot satisfy a later fresh-close check. Keep synchronous synthetic replay explicitly labeled and retain a positive ordinary-close control. A later task is a bounded observation point for the callback under test, not universal quiescence.

## Shared contracts to preserve

| Owner | Required behavior | Remaining pressure to investigate |
| --- | --- | --- |
| Detail route and panel | Section admission is shared across public/signed routes and enhancement rereads. Default/API detail responses retain their full contract. | Default large-title hydration, pagination and retained-card bounds. |
| Activity | Scope, privacy, grouping, occurrence and relationship fallback remain one statement/snapshot contract. | Scoped admission is adopted. Unconditional relationship materialization preserves115 actual outputs but increases friend/watchlist costs; the selective fence is applied after115 actual pairs and58 maintained compile contracts; freshcommonpass and normalacceptance remain separately recorded. History/spill and absent policy cohorts remain open. |
| Library and embedded grids | Appends retain their prior prefix until an intentional, coherent replacement. | New revision/commit trace proves a180→60→120 range loss; generic range/read-cost/privacy/Retry policy and actual acceptance remain. Original300→180 cause stays uninstrumented. |
| Tasks | Current status, null/local sources, generation, timing and representative ordering remain exact. | Query/index pair, writer/HOT/WAL cost, other readers, active-job and growth coverage. |
| Notification toast owner | Inbox read/dismiss state is independent of acknowledged toast suppression; queue/flight bounds and disposal remain explicit. | Actual recent/persistent cohorts and live multi-window acceptance. Normal rollout and separate actual-copy COMMIT/fresh-session proof passed. |
| Navigation and refresh | Cancellation releases its owner, late work cannot overwrite a successor, and active overlays survive shared refresh. | Normal overlap schedules and residual snapshot races. |
| Readers and playback | Close aborts owned work; late image/player output cannot publish; minimize/resume retains the intended session. | Missing actual EPUB, helper/FFmpeg, provider/codec/device and long-soak cohorts. |
| Providers and imports | Reuse projections and parameter representations without changing freshness, paging or write admission. | Original provider metadata, failed/slow providers and bounded cache/eviction contracts. |

These are owner contracts, not an instruction to add an abstraction or dependency. Prefer the smallest shared repair that preserves them.

## Migration and recovery records

The approved normal rollout is the exact reviewed 0062 + 0063 path. Preserve the historical 0039 ledger hash and its unresolved original-byte/data-effect provenance. A successful current-object comparison does not recover those bytes. Never rewrite old history, stamp a skipped migration or run the broad migrator as a read-only pending check.

The [migration review](migration-provenance.md), [pinned plan](candidates/migration/rollout-plan.json) and [rollout decision receipt](evidence/implementation-approved-rollout-decisions.json) distinguish approval, attempted execution, postchecks and app acceptance. The checkpoint is private actual data and stays outside the repository. Full archive extraction proves readability, not a completed restore rehearsal. An uncertain migration attempt requires read-only reconciliation before another attempt. Retaining the additive toast column and ledger is the default application rollback path; dropping them would remove saved suppression state.

## Updating evidence and reports

Capture a new implementation source inventory for an intentional change; leave the immutable baseline inventory untouched. Update current source pins with a named later-change boundary. Keep historical source manifests, measurements and failures intact, and do not claim an earlier owner experiment ran on the new source.

Regenerate the maintained views after updating the ledger:

```sh
python3 docs/audits/2026-10-17-app-performance/consolidate.py
python3 docs/audits/2026-10-17-app-performance/render-implementation-ledger.py
python3 docs/audits/2026-10-17-app-performance/render-remaining-work.py
python3 docs/audits/2026-10-17-app-performance/render-remaining-work.py --check
python3 docs/audits/2026-10-17-app-performance/verify-report-integrity.py \
  --output docs/audits/2026-10-17-app-performance/evidence/implementation-report-integrity.json
git diff --check
```

The default remaining-work renderer first requires the curated open IDs to match the ledger, then refreshes only its current ledger-identity stamp when needed. Its `--check` mode is read-only and rejects a stale stamp. It does not change statuses, options, source pins or runtime acceptance.

The integrity check covers record identity, the open set, rendered statuses, local links and explicit current source/artifact pins. It does not certify runtime completeness. Its toast adoption branch now checks the immutable review patch/manifest hashes, all 14 current candidate files, reverse applicability and the successful normal rollout receipt. A forward apply failure is expected after adoption. Historical staged checks remain separately retained.

An issue remains partial while required actual cohorts or acceptance are missing. Document the next experiment, competing options, observed costs and approval boundary. Do not close it because the common tests pass or the report is large.

Rune verification must erase TypeScript without folding bare identifier reads before Svelte compilation. Use tests/fixtures/ui-script.ts eraseTypeScript/compileRunes for source-derived component tests; preserve meaningful dependency/effect/disposal assertions. Plain SQL/class/function transpilation has a separate purpose. The maintained ui-script test protects this preprocessing contract, and historical receipts keep their then-current compiler boundary.

Tasks writer measurements must separate changed-indexed-column controls from natural active/HOT/commit owners. Use saved actual identities, exact server timestamp text, complete expected row and side-effect checks, fresh matched layouts and independent cleanup. Sum each statement root once; exclude copy/index-build/commit work from statement WAL. Record full-page images alongside bytes;46→0FPI is a confound, not a byte-efficiency win. Distinct saved rows can yield duplicate reader bindings: count both labeled cases and unique SQL/parameter inputs.

Cumulative statistics can be cached inside a transaction. Equal endpoint reads do not prove an event-free interval unless the protocol explicitly verifies refreshed observations, still allowing publication lag. Future probes should set/verify stats_fetch_consistency=none or clear cached snapshots as appropriate; never reset global statistics to manufacture clean counters. Keep current-transaction pg_stat_xact_user_tables measurements separate. The [actual Tasks W0 report](task-writer-cost-actual.md) explicitly limits its misleadingly broad immutable checkpoint field without rewriting that receipt.

## Public Library seed/closure drift

The [applied seed guard](implementation-public-seed.md) requires its canonical access predicate, MATERIALIZED seed reuse and recursive identity UNION to remain together. Before changing planner/schema/access/edge/response or real catalogue scale, compare complete actual positive/inherited/empty/other-owner outputs and inspect whole-plan root/graph/temp counters, then fresh CPU and resident profiles. Output-only equivalence missed two rejected resource variants. Keep the96KiBretained-capacity increase and tinyempty CPU/elapsed limits; growth and bearer-token HTTP remain separate. The frozen local protocols require deliberate refresh after drift; preserve old receipts and avoid synthetic catalogue acceptance.

## Watch Library membership and range drift

The [applied one-page query](implementation-library-membership.md) must preserve one exact canonical membership SQL/binding prefix, full count/clamp/ordered IDs, complete DTO and existing secondary hydration query multiset. The installed native driver does not preserve the object execute generic through its broad array HKT; keep a narrow asserted aggregate shape at that boundary rather than spreading any through callbacks or adding a driver shim. Type-only transfers require exact compiled-runtime equality and successful final typing; an old main-data run is not a new run on later source.

Keep all recorded resource counters: lower retained allocator/positive CPU coexists with higher default privateDirty/PSS/RSS and some tinyempty readings. Recheck actual larger membership, sort andspills after source/schema/runtime/catalogue growth. Sum original count/page roots as two separate reads, never inclusive plan descendants. Current-source maps advance through named later changes; historical run manifests and failed typechecks remain exact.

The [selected range preparation](library-server-range.md) proves eight ordinary Watch domain intervals only. Preserve local60-row hydration and Listen50-per-source page-major ordering; reading progress LIMIT 60 and per-page game ranking need owner-specific execution. One request is not one provider call or a range memory budget. Measure range resources and actual client prefix/failure/cancellation before adoption. No arbitrary window/cap, cache, 503 mapping or cross-network transaction is accepted by preparation alone. After building, let normal dev finish reloads before the accepted browser sequence. Native accessibility abbreviates hrefs; use rendered DOM for exact card target counts and retain observation corrections.


### Bounded catalogue protocol

Follow the [shared guide](../../performance.md#bounded-catalogue-neighborhoods-and-retained-action-owners) and [batch04 evidence](implementation-found-04.md) when native widths, range selection, hydration, scope keys, action ownership, retry, sheet geometry or browser history change. `tests/fixtures/library-window.ts` accepts only an actual reader; its authored delivery/failure schedules were run under the pinned read-only clone frame, not as fabricated catalogue fixtures. Keep CPU/heap/browser/source-count/positive-mutation gaps distinct from DOM and complete-DTO evidence. Review/re-freeze the archived probe before rerunning against a new actual clone; do not merely refresh evidence hashes.

Later applied known-partial work: [shared diagnostic output admission and hidden glass resources](implementation-found-05.md). Actual-copy and signed-in acceptance are scoped; unchecked areas stay deferred and known work remains active. Use `bun run test` to avoid discovering archived test snapshots.

Later known-partial repair: [native Back and pending search intent](implementation-found-06.md), verified with actual normal search and a canonical ordered50card comparison. Other unresolved acceptance and unchecked areas retain their separate disposition.

Later known-work pass: [shared Profile genre-history reuse](implementation-found-07.md) applied after108complete actual outcomes; three Collection traversal alternatives remain unadopted with adverse evidence retained. Known work is unfinished; unchecked areas remain separate.

Later known-work repair: [item-scoped Collection evidence](implementation-found-08.md), shared by assessment consumers. Two staged actual-data acceptance runs and final authenticated normal consumer pass. Known open/partial work remains unfinished; unchecked areas remain separate.

Later shared repair: [menu scope reuse and hero capability withdrawal](implementation-found-09.md). Actual-input/native acceptance and authored feature-Off controls remain distinguished. Known work is unfinished; unchecked areas are separate.

Later shared repair: [Profile activity evidence and committed context](implementation-found-10.md).36actual complete outcomes and final841commonpasses; normal preference-save side effect and native pending-proof limit recorded. Known work remains unfinished.

Later shared repair: [guarded Profile favourite count reuse](implementation-found-11.md).192actual complete outcomes;60filtered SQL families unchanged; regressed unconditional option rejected. Known work remains unfinished.

Current update: [approved shared avatar/0064 normal adoption](implementation-found-16.md), [adjacent-period Profile reuse](implementation-found-14.md) and [reverted season candidate](implementation-found-15.md). 23 open /37 partial canonical records; wider known work remains active, unchecked areas deferred, Tasks pair retained.

Latest shared repair: [Taste feature witnesses](implementation-found-17.md), with complete actual selections/profiles/scores and current gates. 22 open /38 partial canonical records; broader known work remains active and unchecked areas deferred.

Latest verification: [four further Taste options rejected](implementation-found-18.md). Current adopted source stays batch17; exact actual selections/scores match but all four shapes regress warm medians. Counts remain22open /38partial; unchecked areas deferred.

Further verification: [completed-season boolean option](implementation-found-19.md) preserves actual results/membership but remains unapplied after mixed timings. Known implementation remains active; unchecked areas deferred.


## Current evidence, actual-data guards and retention

The latest runtime batch is [Activity27](implementation-found-27.md):844 common passes /716 guarded skips /0failures plus type/build/inventory/style;28 complete benchmark pairs,22 native semantic/privacy pairs and signed-in normal global/item rendering are separate actual-data receipts. The original application comparison predates this Activity repair. Tasks source/SQL is unchanged and its adverse elapsed ratio did not reproduce. Do not use a documentation epoch to refresh these measurements or claim universal speedup.

`tests/activity-policy-admission-db.test.ts` and `tests/activity-scope-admission-db.test.ts` intentionally skip ordinary authored-fixture databases. For a future approved actual-copy run, the orchestrating launcher must supply `DATABASE_URL` in memory, `COAST_DB_TEST=1`, `COAST_AUDIT_REAL_DATA_CLONE=1`, exact `COAST_AUDIT_EXPECTED_DATABASE`, and the explicit policy/scope regression lease flags. Each file enforces the named owned local-copy pattern,127.0.0.1:55432, zero other client backends, repeatable-read/read-only transaction and native policy stability; do not bypass these guards or point at normal dev. Run the two files alone through Bun's builtin `test` command after acquiring exclusive ownership. Capture pool closure/restoration separately. These admission-ID tests do not replace full native DTO/privacy/filter tests or real browser acceptance.

Use actual admin/catalogue identities. Controlled private-copy state is authorized and must be labeled/restored; naturally observed provider/production behavior is a different evidence class. A missing natural state is not itself a reason to stop safe controlled acceptance. Missing actual file/provider/workload or unresolved behavior contracts remain prerequisites. The earlier synthetic Collection harness is supplementary authored regression, not this pass's real-data performance evidence.

Housekeeping retained old rolling summaries as exact [history snapshots](history/closeout-2026-10-19/manifest.json), plus rejected trials, proof scripts, source/lock/patch snapshots and actual recovery material. Only named private staging dependencies, builds and generated caches were removed; [cleanup receipt](evidence/housekeeping-cleanup.json). Old staging scripts require exact dependency reinstall/build regeneration. Keep private payloads/content/checkpoints out of Git. Do not delete pinned evidence to reduce clutter; reconcile its role first.

Current entry points carry current counts once. Preserve dated proof epochs, and put new outcomes in the ledger/remaining checklist rather than appending competing “latest” paragraphs. Check current counts, all94IDs, nine future workstreams, failed-method/default decisions, local links and source/artifact pins with `verify-report-integrity.py`. The checker now guards the final closeout/checklist agreement as well as historical source epochs.

Public review packaging: [portable evidence and private-original boundaries](publication.md). Historical artifact links require the documented archive extraction; private screenshots/personal-state originals are excluded. The public projection check is separate from original full-byte native acceptance.
