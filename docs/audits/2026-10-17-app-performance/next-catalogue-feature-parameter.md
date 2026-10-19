# Catalogue feature parameter reuse — implemented narrow slice

The actual retained catalogue contains a usable positive input cohort for the next narrow [parameter admission check](next-parameter-admission.md). The exact one-expression repair is now adopted after the approved private rollback proof and independent review. The proof verifies parameter reuse and output/state equality; it establishes no CPU, heap, wire-traffic or latency gain. This is a follow-up to the still-partial DATA-07 finding.

The shared owner is `src/lib/catalogue/service.server.ts:223`. The adopted change replaces only conflict assignment `features: metadata.tasteFeatures` with ``features: sql`excluded.features` ``. It retains the existing `tasteFeatures !== undefined` guard, the independently sampled conflict update timestamp, the insert timestamp default, identity locks, full metadata snapshot handling and returned media object. Its before/candidate hashes are `a15422b9a9cd1312c2d68a40fc30e3e0df4e4efd792fb7159ff629636d7c3366` and `c84a162bcf380326f8c02a3ed5fa76f135716fcc5581804a04eb814934986e7a`. The exact [baseline](candidates/catalogue-feature-parameter/service.before.ts.txt) and [candidate](candidates/catalogue-feature-parameter/service.candidate.ts.txt) are review artifacts.

Preserving the timestamp matters: `workTasteFeatures` selects each dimension by provider `updated_at` precedence. An unchanged-value early return would be a separate semantic change. This change reuses the native JSONB value already admitted by the insert branch; it adds no write suppression, cache, helper framework or schema change.

## Actual read-only census

The [executed probe](probes/catalogue-feature-input-census.ts) and [aggregate receipt](evidence/catalogue-feature-input-census.json) retain the exact source pins. One reserved connection explicitly verified READ ONLY, repeatable read, a 10-second statement timeout and 1-second lock timeout. It rolled back and closed its pool before release to the next agent. There were no provider attempts, credential reads in the probe, fixtures or database mutations; the established runner supplied the designated private-clone connection in memory.

| Observation | Actual count |
| --- | ---: |
| Retained metadata snapshots, all with object raw payloads | 180,850 |
| Raw snapshots with defined object taste features | 4,823 |
| TMDB movie snapshots with those features | 3,347 |
| TMDB show snapshots with those features | 1,476 |
| Current same-work/provider feature rows exactly equal to the retained objects | 4,823 |
| Empty objects, explicit nulls or other feature types | 0 |
| Total current work-feature rows across the catalogue | 5,993 |

All 4,823 positive snapshots passed SQL identity-header checks. Full recursive `Metadata` shape and feature validation was deliberately bounded to the first 100 exact-match retained snapshots ordered by internal snapshot identity. All 100 passed, matched their stored language/region and snapshot title, and retained the ingestion owner's existing detail markers. Their feature objects contained 2,854 occurrences across 350 nonempty dimensions. The exact raw objects occupied 741,081 bytes and their feature objects 129,940 bytes under `JSON.stringify` UTF8 accounting; these are input representation sizes, not measured driver encoding, wire traffic or heap allocation.

No object was enriched, reconstructed from independent saved fragments, or represented as a fresh provider response. IDs, titles, feature names, source URLs and raw payloads were inspected only in memory and omitted from the receipt. Full shape validation of the remaining 4,723 positive snapshots has not run. The corpus provides no empty-object or non-TMDB positive replay acceptance.

## Reviewed rollback protocol

The reviewed protocol runs both complete ingestion owners on the same 100 retained raw objects without altering their fields. Revalidate their exact current feature equality, shape and stored source scope; count actual movie/show coverage and select additional existing objects only if a kind is absent. Use the established guarded private clone and no provider transport or secret decryption. The ordinary `ingestMetadata(raw)` path can preserve the naturally retained movie/show identities; do not manufacture richer inputs or enable different settings.

Compare baseline and candidate in real nested savepoints within one outer rollback transaction, fixing only the module's observation clock for equality. Keeping both variants in the same outer transaction also preserves PostgreSQL transaction time. At each complete-corpus comparison boundary, flush pending revision constraints and compare complete returned objects, feature rows including timestamps, metadata snapshots/raw, identifiers and content revisions. Compare canonical `workTasteFeatures` outputs as well, then require exact whole-database logical values and sequence restoration after rollback. Record the longer-held outer transaction/savepoint limitation rather than claiming normal concurrent commit schedules.

Count the exact feature object's native parameters only at the work-feature upsert boundary: the expected change is two bindings to one. Preserve DML/returned-row and transaction admission. Serialized parameter sizes remain proxies; do not infer fewer writes, roundtrips, WAL, CPU, heap usage, wire bytes or latency. Supplementary driver/source controls should preserve defined nonempty and empty values and the existing omitted-input guard, clearly separated from actual-data acceptance.

The [structured proposal](next-catalogue-feature-parameter.json) records the current source and artifact pins. The private rollback proof passed and the exact candidate was subsequently adopted with parent approval. The original actual receipt is retained unchanged: its baseline production fields describe the pre-adoption proof. This repair leaves broader feature freshness/no-op policy choices open.

## Executed private full-owner result

The exact [executed proof source](probes/catalogue-feature-parameter-candidate-actual.ts) and [aggregate receipt](evidence/catalogue-feature-parameter-actual.json) preserve the private candidate/source pins and stepwise aggregate progress. This captured probe uses the original private baseline/candidate paths and intentionally requires production to remain the audited baseline; it is historical evidence, not an adopted-source replay command.

Both complete owners processed the same 100 unmodified retained objects: 68 movies and 32 shows, all TMDB. Complete returned media objects, all table post-values, canonical `workTasteFeatures` outputs, tuple changes, DML admission and logical owner transaction counts matched. The sample has zero works with multiple feature providers, so the canonical read comparison does not establish an actual competing-provider precedence transition.

| Measured owner metric | Baseline | Candidate |
| --- | ---: | ---: |
| Drizzle execute statements | 1,193 | 1,193 |
| Logical owner transactions within rollback savepoints | 100 | 100 |
| Bound parameters | 4,408 | 4,308 |
| Exact native feature-object parameters | 200 | 100 |
| Feature-object serialized UTF8 size proxy | 259,880 | 129,940 |
| All-parameter JSON array UTF8 size proxy | 1,106,702 | 976,662 |
| Work-feature upserts / affected rows | 100 / 100 | 100 / 100 |
| Metadata-snapshot updates / affected rows | 100 / 100 | 100 / 100 |

Each variant still changed 100 feature tuples, 100 snapshot tuples and two content-revision tuples; media and existing external-identity tuples stayed unchanged. This is an exact parameter-admission reduction, with required writes and freshness behavior preserved. Captures and the canonical raw-SQL feature read are outside the owner Drizzle counters.

The actual work-feature relation had exactly the three expected enabled AFTER statement triggers (insert/update/delete), with the reviewed content-revision function body. Both corpus variants ran in separate rollback savepoints of one outer repeatable-read transaction, explicitly verifying writable mode and 30-second statement / 5-second lock budgets. Only the privately loaded catalogue module's `new Date()` observations were fixed equally; canonical dependencies remained unchanged. The feature reader temporarily used the same real transaction connection through the existing `getSql` lookup. This keeps the result inside the candidate's uncommitted state and does not introduce an application cache or new production API.

All 102 table logical multisets containing 1,864,145 rows and all reported sequence values matched exactly before/after the outer rollback. The pool closed, zero provider attempts occurred, and production remained baseline `a15422…`. The clone slot was released directly to the next agent. Logical rollback restoration does not imply zero WAL or dead tuples, and held outer locks/savepoints do not certify ordinary per-item commit/release or concurrent publication schedules. No actual empty, omitted, changed-feature or non-TMDB positive payload was invented; the maintained supplementary source/driver contracts below cover defined and omitted admission without claiming new actual-data cohorts.

## Adoption and maintained contracts

Current catalogue source is byte-identical to executed candidate `c84a162bcf380326f8c02a3ed5fa76f135716fcc5581804a04eb814934986e7a`. Only the approved conflict feature assignment changed; unrelated existing owner changes remain. Independent source/proof review found no material blocker. DATA-07 remains partial: metadata timestamps, provider precedence, required writes and other writers were not redesigned or suppressed.

`tests/catalogue-feature-binding.test.ts` compiles the real guarded source statement through the installed Drizzle dialect and native Bun JSONB column codec. Its authored values cover defined nonempty and empty objects, exact one-object binding, the insert's database timestamp default and separate conflict `new Date()` observation, plus both omitted and explicit-undefined features admitting no insert or timestamp observation. These are meaningful driver/admission contracts, not fabricated database acceptance cohorts. The focused run passed **2 tests / 16 assertions / zero failures**; its [captured output](evidence/catalogue-feature-parameter-tests.txt) is retained. `git diff --check` passed. Common gates remain parent-owned.

The [maintained replay](probes/catalogue-feature-parameter-real.ts) resolves the saved baseline relative to the report, loads the exact current adopted source, and requires an explicit rollback flag plus the designated private-clone connection/source/input guards. It was syntax checked only; no post-adoption DB rerun is claimed. The [original executed probe](probes/catalogue-feature-parameter-candidate-actual.ts) and receipt stay historical and unchanged. No normal database write, schema change, migration, dependency or provider call was introduced.

Current combined gates:791pass/710guardedskip/0fail/33,722assertions across1,501tests/279files; typecheck0errors/0warnings; build/inventories/style passed. The [frozen authenticated normal5173 trial](evidence/implementation-ancestor-material-normal.json) passed account/nested/task/movie/comic menus, Library120media links/28completedimages, Read12actualcomics, Continue34links/13completedimages, Admin and final30pausedTasks, with0dialogs/0popovers/0newwarnings/errors and unchangedsource. Open menus usednativeglass; closedmenuowner markers were0 and the originalaccountfilter wasremoved. CustommediaEnteropens, whileArrowDowndidnot; sharedaccountArrowDown/nestedArrowRight/Escape passed. No mutationcommand was submitted, and no liveingestion/helperwrite/CPU/heap/GPU/network/touch/longsoak claim is made.
