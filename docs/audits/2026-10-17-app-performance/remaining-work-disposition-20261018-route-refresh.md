# Remaining open work — source-only disposition

This document covers exactly **46 canonical records whose ledger status was open at the captured snapshot**, after DATA-07 became partial for its profile-writer slice. Every listed status remains open. It does not replace the original options, advance the ledger, or imply that partial, staged or investigation records elsewhere are complete. The [implementation ledger](implementation-ledger.md) remains authoritative.

[Machine-readable disposition](remaining-work-disposition.json) retains the historical captured ledger hash (not refreshed for the MIN-04 supplement), exact ID set, original alternative/acceptance records, overlap IDs and current source fingerprints. This review uses existing primary audit reports, latest actual-data receipts and targeted current-source checks. It ran no database query, provider operation, test or new performance workload for this disposition and made no application change. Source fingerprints identify code; they do not imply a new execution or full branch audit.

## What can proceed without a redesign

Routine candidates are MIN-04 notification batching at the existing bounded owner, PR-09 same-request verified reading context reuse, PJ-02 choosing the winning crop work owner before process creation, UIS-06 unchanged effective glass render-key admission, UPP-03 diagnostic initialization/accounting with complete recovery, and PJ-13 invariant detail/review demand separation in the existing cache. Each still needs the stated meaningful test and actual-data/provider/file coverage. They are candidates, not accepted gains or permission to bypass the current source freeze.

The recently completed [profile no-op predicate](implementation-profile-write.md) and [profile section projection](implementation-profile-sections.md) demonstrate the intended scale: shared owner, exact current contract, real saved-value comparisons, explicit missing cohorts and bounded maintenance. DATA-07 remains partial because metadata, game, list and queue writers have distinct semantics. In particular, work_features timestamps select provider precedence; a blanket identical-feature timestamp guard is unsafe without resolving that behavior. DATA-13's positive public/featured/pinned gaps also remain.

No new dependency is proposed. The user-supplied AGENTS.md says: **“Prefer the simplest solution that fully solves the problem. Ask before introducing unavoidable complexity.”** It separately says: **“Ask before adding production dependencies.”** Those are conditional implementation rules, not a blanket approval requirement for an audit, measurement or routine fix. A semantic/product boundary below identifies behavior that needs a concrete choice before implementation; it does not invent a permission gate. First determine whether the existing approved contract supports a small routine solution. If the selected behavior unavoidably needs substantial complexity or a production dependency, present that exact plan and ask then.

## How to read the disposition

“Measurement gap” means actual data may exist but the plan/cost/equivalent rewrite is not established. “Actual cohort gap” means the relevant positive state, real file, provider trace or active scale was absent from existing evidence. “Semantic contract” means a tempting shortcut can change grouping, ordering, freshness, privacy, history, acknowledgement or approved UX. “Substantial complexity” marks a larger optional implementation requiring a concrete bounded design; it is not a claim that every possible fix needs a new architecture. The categories overlap and are not additive defects or gains.

Keep missing real lists, pending grouped recommendations, active parties and EPUB/PDF/provider failure traces explicit. Do not manufacture catalogue, preference, task or history populations to claim actual-data performance acceptance. Controlled correctness faults may supplement the real cohort and must remain labelled separately.

The original audit links retain all alternatives; the machine record also retains their original option/acceptance fields. The suggested minimal option below does not remove alternatives or approve a redesign. Existing source line references may belong to the pinned baseline; current source hashes are provided separately.

## Data and small shared opportunities

### DATA-03 — list removal and reorder issue one update for every member under an owner-wide lock

**Status remains open. Shared owner:** Core list mutation service.

**Minimal option:** Keep exact list/user locks and permutation validation; use one set-based changed-position write and return early for an absent removal or unchanged reorder.

**Actual evidence and gap:** Both captured installations and the private clone have zero saved lists/items; repeated-entry and export cohorts are absent.

**Next meaningful test:** When a real list exists, compare complete first/middle/last/absent remove and same/reversed order, Undo, revisions/exports, concurrent add/delete and statement/affected-row counts in rollback.

**Disposition:** The routine set-based direction is clear, but no actual nonempty list can verify order, repeated occurrences or export effects. Sparse/fractional positions are an optional larger redesign, not required for this next step. Reasons: positive actual cohort/trace gap.

**Overlap:** DATA-12, PJ-06, UIS-03. Do not count shared repair gains twice. Original options and evidence: [data-api.md](data-api.md).

### DATA-04 — initial screen details materialize complete child and overlapping parent-collection cards

**Status remains open. Shared owner:** Shared screen detail composition and detail row sources.

**Minimal option:** First share the union of required collection/parent member identities within detailsData and remap each exact sequence occurrence. Separately specify demand-paged detail rows if full initial hydration remains costly.

**Actual evidence and gap:** Actual season829 and collection23 prove large complete response work. Those measured details have zero parentCollections, so cross-parent overlap savings are not verified.

**Next meaningful test:** Read-only census natural overlapping/nested collection details; compare every existing DTO field, occurrence/order, next context and missing/privacy behavior while counting unique and duplicate card admission. Retest the829-episode response and browser resources.

**Disposition:** Union hydration is a routine candidate once a positive overlapping cohort is located. Deferring full-row paging preserves approved completeness/anchors; it must not silently truncate initial detail arrays. Reasons: positive actual cohort/trace gap; behavior contract to preserve or resolve.

**Overlap:** UIS-03, UIS-04, MIN-02. Do not count shared repair gains twice. Original options and evidence: [data-api.md](data-api.md), [data-api-real-reads.json](evidence/data-api-real-reads.json), [implementation-menu-context.md](implementation-menu-context.md).

### DATA-05 — Continue and the initial home hero still plan from the owner's complete screen state and descendant sets

**Status remains open. Shared owner:** Shared continuation/progress planner.

**Minimal option:** Move only provably ineligible states before hydration or reuse one exact plan when one request actually needs it twice. Larger SQL/durable continuation projection must preserve next-season/rewatch/membership rules.

**Actual evidence and gap:** Actual owner returns97 Continue candidates,60 cards,43,200 ORM rows; function median488.73ms. Its separately forced recursive-factor EXPLAIN is exploratory, not the normal plan. Saved playlists/rewatches are absent.

**Next meaningful test:** Compare complete IDs/order/count/next context and actual default-setting plans for broad real owners, dropped/availability/season boundaries and hero versus Continue; retain missing playlist/rewatch gaps.

**Disposition:** No small filter has yet been proven equivalent. A durable projection adds write-side invalidation/rebuild obligations and is an optional architecture choice, not an automatic fix. Reasons: behavior contract to preserve or resolve; larger option needs a concrete complexity plan; positive actual cohort/trace gap.

**Overlap:** DATA-02, DATA-04, PLAN-09. Do not count shared repair gains twice. Original options and evidence: [data-api.md](data-api.md), [data-api-real-reads.json](evidence/data-api-real-reads.json).

### DATA-06 — received-recommendation progress fetches all candidates and assesses all candidates before paging

**Status remains open. Shared owner:** Received recommendation progress projection and shared assessment SQL.

**Minimal option:** Separate an exact all-pending count from the selected visible-page projection and assess only admitted identities through the same recommendation/privacy owner.

**Actual evidence and gap:** The measured selected owner has no pending received recommendations. Existing social/friend records do not supply a verified multi-sender pending cohort.

**Next meaningful test:** Use naturally pending actual recommendations; compare complete grouped IDs/senders/names/order/total and Save/Dismiss outcomes across privacy/feature/source withdrawal, then SQL/admission counts.

**Disposition:** Grouping and availability can affect page membership; limiting raw candidates before the exact grouping/filter boundary would change results. Reasons: positive actual cohort/trace gap; behavior contract to preserve or resolve.

**Overlap:** UIC-03, DATA-14, PLAN-04. Do not count shared repair gains twice. Original options and evidence: [data-api.md](data-api.md), [data-api-real-reads.json](evidence/data-api-real-reads.json).

### DATA-09 — inline raster avatars amplify settings reads and repeated social payloads

**Status remains open. Shared owner:** Existing profile avatar storage/stream owner.

**Minimal option:** Extend the existing permission-checked avatar storage/stream lifecycle for raster formats, retaining exact appearance, privacy, hashed identity, replacement cleanup and session fields. Further narrow non-display settings reads only by a complete consumer contract.

**Actual evidence and gap:** Three actual development and four deployed inline-avatar accounts exist; actual maximums are about15KB, far below the220,000-character cap. Scope omission already removes repeated key serialization only.

**Next meaningful test:** Replay copies of actual PNG/JPEG/WebP/GIF through private storage and measure real compressed session/social bytes and image-request/cache behavior; verify policy change, replacement/error cleanup and old-image denial.

**Disposition:** Representation changes need a concrete storage/stream/migration/failure plan; the observed bytes do not justify an unmeasured broad settings or filesystem rewrite. No dependency is required by the minimal option. Reasons: behavior contract to preserve or resolve; larger option needs a concrete complexity plan.

**Overlap:** UIS-07, HELPER-01, UIC-01, UPP-02. Do not count shared repair gains twice. Original options and evidence: [data-api.md](data-api.md), [development-real-sql.json](evidence/development-real-sql.json), [deployed-real-sql.json](evidence/deployed-real-sql.json), [implementation-work-menu-scope.md](implementation-work-menu-scope.md).

### DATA-12 — a playlist-start command reads the complete list to inspect one header field

**Status remains open. Shared owner:** Core list header/summary/detail reader.

**Minimal option:** Add/reuse an owner-validated list header read for playback-start admission; retain the complete getList and existing complete endpoint until consumers/contracts are deliberately changed.

**Actual evidence and gap:** Zero saved lists/playlists in actual snapshots. Header-only admission has no positive existing-list replay.

**Next meaningful test:** On an actual list, compare start/already-started/restart/missing/cross-owner responses and timestamp behavior; prove zero item hydration and unchanged full-list/summary/paged output.

**Disposition:** This is a routine narrow projection, not a necessary architecture change. Missing actual lists prevent the requested positive acceptance; endpoint retirement is a separate contract choice. Reasons: positive actual cohort/trace gap.

**Overlap:** DATA-03, PJ-06. Do not count shared repair gains twice. Original options and evidence: [data-api.md](data-api.md).

### MIN-03 — Catalogue and accessible-library responses use full `workCards` then the non-personal DTO discards state, artwork, credits and most metadata.

**Status remains open. Shared owner:** src/lib/server/public-api/handler.server.ts:58-81`, `response.ts:6-9.

**Minimal option:** Extract a non-personal identity projection through the existing medium presentation owners, preserving title override/game variant/year/reading attribution and privacy precedence.

**Actual evidence and gap:** Actual screen/game/music/comic identities exist; no saved book cohort, and reduced-head game private preferences/variants are sparse. Current full-card oracle is available.

**Next meaningful test:** Compare complete public catalogue/detail/library DTOs for all actual admitted kinds and selected metadata preferences/editions/attribution before counting statement/row/byte reduction.

**Disposition:** A plain works-table SELECT drops medium presentation contracts. No coherent shared narrow projection was established; avoid a private endpoint shortcut. Reasons: behavior contract to preserve or resolve; positive actual cohort/trace gap.

**Overlap:** DATA-11, DATA-09, PR-09. Do not count shared repair gains twice. Original options and evidence: [data-api.md](data-api.md), [implementation-profile-sections.md](implementation-profile-sections.md), [implementation-card-categories.md](implementation-card-categories.md).

### MIN-04 — A source change sends one notification operation per affected user, each independently reading config/preferences.

**Status remains open. Shared owner:** src/lib/collection/source-changes.server.ts:57-58.

**Minimal option:** Review one canonical preparation pass with ordered individual writes to preserve statement-level partial delivery. Direct `notifyMany` is smaller but changes chunk failure atomicity. Neither settings-snapshot nor atomicity behavior has been adopted.

**Actual evidence and gap:** The [read-only census and next-batch options](next-notification-batch.md) found one enabled Jellyfin instance with4 connected bindings/4 existing enabled owners,518 saved notices and0 saved source-review keys. No source mutation, notification replay or natural failure schedule ran.

**Next meaningful test:** Select the exact delivery/snapshot contract, then compare full baseline/current notices for those4 bindings under rollback, including all original518 rows, source keys, preferences/visibility and raw SQL counts. No actual disconnect/delete is needed.

**Disposition:** This remains a small routine candidate. Source mutations commit before delivery; direct multi-row batching changes the earlier committed prefix on a later error. Shared preparation also changes preference-read timing. The published options establish no measured speedup and authorize no semantics change. Reasons: routine candidate; meaningful verification still pending; positive delivery/upsert cohort gap; behavior contract to preserve or resolve.

**Overlap:** MIN-07, PJ-06. Do not count shared repair gains twice. Original options and evidence: [data-api.md](data-api.md), [next-notification-batch.md](next-notification-batch.md).

### MIN-07 — Up to20 friend relationships are checked serially twice during creation, then reminders notify up to21 users serially.

**Status remains open. Shared owner:** src/lib/experiments/planning.server.ts:18-22,63-65.

**Minimal option:** Deduplicate friend IDs before checks; batch authoritative friendship admission inside the existing transaction, and reuse notifyMany for eligible reminders without dropping transaction-time feature/privacy validation.

**Actual evidence and gap:** Accepted friends exist, but no positive saved plan/reminder or20-friend plan operation was captured.

**Next meaningful test:** Census existing scheduled plans; on naturally available rows compare complete friend admission/recipients, duplicate inputs, withdrawn friendships/features and reminder upserts in rollback with exact query counts.

**Disposition:** A bounded routine batching option exists, but preflight and transaction checks are intentionally distinct and must not be collapsed into stale authorization. Partial reminder failure needs the same notification contract as MIN-04. Reasons: positive actual cohort/trace gap; behavior contract to preserve or resolve.

**Overlap:** MIN-04, PJ-14. Do not count shared repair gains twice. Original options and evidence: [data-api.md](data-api.md).

## Measurement-gated query leads

### PLAN-02 — activityFeed

**Status remains open. Shared owner:** activityFeed.

**Minimal option:** Capture actual activityFeed grouping plans first; only move an exact boundary-preserving page plan or maintained grouped projection into its shared owner.

**Actual evidence and gap:** Actual long watch/listen histories and friend relationships exist; no current complete feed plan/late-cursor equivalence demonstrates a repair.

**Next meaningful test:** Use actual user feeds and cursor boundaries; compare album/episode runs, unknown dates, listen numbering, repeated events, reactions and relationship rows before/after EXPLAIN/row counts.

**Disposition:** This is a measurement-gated query shape, not a verified bad plan. Early raw-event LIMIT changes grouping; a durable grouped projection adds replay/invalidation obligations. Reasons: actual measurement/equivalence gap; behavior contract to preserve or resolve; larger option needs a concrete complexity plan.

**Overlap:** DATA-05, PR-14, PLAN-09. Do not count shared repair gains twice. Original options and evidence: [data-api.md](data-api.md).

### PLAN-03 — Taste staleness/ranking

**Status remains open. Shared owner:** Taste staleness/ranking.

**Minimal option:** Measure current ten-user taste staleness/ranking query; hoist invariant aggregate work only if actual plans and full candidate/order comparison prove equivalence.

**Actual evidence and gap:** Four actual enabled owners and retained taste evidence exist; the completed MIN-08 overlap proof is a different owner. Larger ten-user/candidate cardinality is not observed.

**Next meaningful test:** Capture actual staleness/candidate SQL plans and complete selected users/ranks across policy/revision/date cases, retaining any empty/absent dimensions and current lease/checkpoint behavior.

**Disposition:** No bad plan or candidate-selection-preserving rewrite has been verified. Existing bounds/compiled scorer/checkpoint/fencing must remain; no new cache or population is warranted by source shape alone. Reasons: actual measurement/equivalence gap.

**Overlap:** MIN-08, PLAN-04, PLAN-05. Do not count shared repair gains twice. Original options and evidence: [data-api.md](data-api.md), [implementation-taste-overlap.md](implementation-taste-overlap.md).

### PLAN-04 — Recommendation scoring

**Status remains open. Shared owner:** Recommendation scoring.

**Minimal option:** Measure the existing2000-candidate preselection and100-positive-evidence scoring; optimize joins/aggregation within the exact existing ranking contract first.

**Actual evidence and gap:** Actual recommendation catalogue/evidence exists; no completed current scoring plan or quality-neutral preselection change is established.

**Next meaningful test:** Compare full candidate/score/order results and actual plans for saved evidence across enabled media; preserve ties, missing features and feature/privacy decisions.

**Disposition:** Changing preselection cap/rank is also recommendation-quality behavior. A source bound is not evidence that reducing candidates preserves recommendations. Reasons: actual measurement/equivalence gap; behavior contract to preserve or resolve.

**Overlap:** DATA-06, PLAN-03, MIN-08. Do not count shared repair gains twice. Original options and evidence: [data-api.md](data-api.md).

### PLAN-05 — Feed definition census

**Status remains open. Shared owner:** Feed definition census.

**Minimal option:** Profile the current one-census feed definition/interest/adjacency work; reuse only proven request-local invariant computations through the existing feed owner.

**Actual evidence and gap:** Actual350 definitions/63,551 JSON bytes and1,151.91ms median were recorded. Direct BunSQL counts were not instrumented; no dominant subquery/subject fanout attribution yet.

**Next meaningful test:** Run source-pinned actual interest/feed/adjacency timings and safe plans with complete definition/order equivalence; count raw SQL as well as ORM and compare revisit demand separately.

**Disposition:** The old repeated-per-page census is already repaired. Further reuse/caching has no proven freshness/key/invalidation benefit and would add ownership without attribution. Reasons: actual measurement/equivalence gap.

**Overlap:** PLAN-03, PLAN-04, UIS-03. Do not count shared repair gains twice. Original options and evidence: [data-api.md](data-api.md), [data-api-real-reads.json](evidence/data-api-real-reads.json).

### PLAN-06 — Admin missing demand

**Status remains open. Shared owner:** Admin missing demand.

**Minimal option:** Separate exact consenting-user count/existence from selected-user detailed missing-demand projection while keeping authoritative feature/privacy/source predicates.

**Actual evidence and gap:** Actual consenting accounts and catalogue exist; a large consenting-user demand cohort and current per-user plan distribution are not measured.

**Next meaningful test:** Capture adminDemand complete user IDs/order/totals and per-user60-detail arrays with actual plans; verify consent/disabled/availability withdrawal before admitting narrower detail work.

**Disposition:** The final60-user page does not prove the upstream projection is bad at current scale. Count/detail splitting requires exact consent/filter membership, not a blind early user LIMIT. Reasons: actual measurement/equivalence gap; behavior contract to preserve or resolve.

**Overlap:** DATA-14, UIC-04. Do not count shared repair gains twice. Original options and evidence: [data-api.md](data-api.md).

### PLAN-08 — Profile insight aggregations

**Status remains open. Shared owner:** Profile insight aggregations.

**Minimal option:** Reuse exact watch-history aggregates/CTEs inside shared profile insight readers where plans show repeated work, retaining complete all-time dates and six+Other genre totals.

**Actual evidence and gap:** Actual histories up to10,779 displayed-history total and long daily evidence exist. DATA13 proves section projection equality, not insight aggregate optimization.

**Next meaningful test:** Capture actual all/month/year insight plans/returned rows and compare complete totals/daily/genre/rating/season outputs including unknown dates and leap/day boundaries.

**Disposition:** No query-level duplicate aggregate cost or safe SQL rewrite is verified. The calendar-bucket CPU repair and section projection do not close this plan lead. Reasons: actual measurement/equivalence gap.

**Overlap:** DATA-13, UPP-01, PLAN-02. Do not count shared repair gains twice. Original options and evidence: [data-api.md](data-api.md), [implementation-profile-sections.md](implementation-profile-sections.md).

### PLAN-09 — Deep numbered pages

**Status remains open. Shared owner:** Deep numbered pages.

**Minimal option:** Measure real first/deep numbered pages at existing query owners; adopt keyset only as an explicit complete pagination contract where offset work is actually material.

**Actual evidence and gap:** Actual large catalogue/history exists, but saved lists are absent and no exhaustive late-page plan/performance comparison was captured.

**Next meaningful test:** EXPLAIN actual first/middle/deep/clamped pages with exact count/order/ties/filter behavior; preserve Back/cursor or numbered-page semantics and public API links.

**Disposition:** OFFSET alone is not a defect. Cursor conversion changes API/navigation semantics and must not be slipped into a small query fix. Reasons: actual measurement/equivalence gap; behavior contract to preserve or resolve.

**Overlap:** DATA-03, DATA-05, PR-14, PJ-10, UIS-03. Do not count shared repair gains twice. Original options and evidence: [data-api.md](data-api.md).

### PLAN-10 — Presence/read freshness

**Status remains open. Shared owner:** Presence/read freshness.

**Minimal option:** Capture active-session/peer visibility plans first; reduce repeated candidate work within the existing presence/read owner while preserving fresh permission and expiration checks.

**Actual evidence and gap:** Actual users and retained sessions exist, but retained39 rooms are not an active-session scale cohort. No current large active-peer plan is established.

**Next meaningful test:** Use actual active source/peer sessions when present; compare visible states/expiration/withdrawal under normal settings, and SQL/rows separately from heartbeat write frequency.

**Disposition:** Existing10s write threshold and revision exclusion are useful. Global inspection in a query is not evidence of a current history-sized scan or leak. Reasons: actual measurement/equivalence gap; positive actual cohort/trace gap.

**Overlap:** PR-08, HELPER-03. Do not count shared repair gains twice. Original options and evidence: [data-api.md](data-api.md).

## Providers, imports, jobs and task controls

### PJ-02 — crop cache does not provide true single-flight

**Status remains open. Shared owner:** Plugin crop work/results owner with thin controller.

**Minimal option:** Choose the winning shared Lazy<Task> entry before starting crop work; exact-entry failure eviction must not remove a replacement.

**Actual evidence and gap:** Actual installed controller behavior was reproduced with controlled process input; deployed plugin/media/contention frequency and actual FFmpeg capture are absent.

**Next meaningful test:** At the real plugin owner, controlled same-key contenders/failure replacement prove one process; then replay one actual authorized trailer/crop and fallback without synthetic media performance claims.

**Disposition:** This separable routine ownership fix does not require aggregate budget policy or a new dependency. Actual plugin acceptance still remains and must not be inferred from stub process counts. Reasons: routine candidate; meaningful verification still pending; positive actual cohort/trace gap.

**Overlap:** PJ-03, PR-12. Do not count shared repair gains twice. Original options and evidence: [providers-jobs.md](providers-jobs.md), [providers-plugin-probe.json](evidence/providers-plugin-probe.json).

### PJ-03 — crop processes and retained results lack aggregate bounds

**Status remains open. Shared owner:** Plugin crop admission/results/process lifetime.

**Minimal option:** Bound active/pending/result crop resources at the shared plugin owner with independent waiters, cancellation and complete process-output/drain ownership.

**Actual evidence and gap:** Controlled lifecycle proof exists; actual FFmpeg RSS/CPU, distinct-trailer concurrency and deployed plugin configuration/load are absent.

**Next meaningful test:** Capture real trailer process/result sizes; verify selected aggregate bounds, cancel-before-start, follower survival, stop/drain, cache invalidation and Coast fallback using actual media.

**Disposition:** Budgets, pending/fallback behavior and lifetime ownership must be concrete before introducing queues/caches. Choose caps from actual process evidence; no invented OOM or arbitrary threshold. Reasons: behavior contract to preserve or resolve; larger option needs a concrete complexity plan; positive actual cohort/trace gap.

**Overlap:** PJ-02, PR-12, PJ-14. Do not count shared repair gains twice. Original options and evidence: [providers-jobs.md](providers-jobs.md).

### PJ-04 — Comic Vine search waits on optional enrichment

**Status remains open. Shared owner:** Reading-provider service/cache demand contract and common origin lane.

**Minimal option:** Keep issue-result and optional series-enrichment demand explicit in the existing reading-provider/cache owner; omit enrichment only where the approved result contract permits.

**Actual evidence and gap:** Controlled2/3-call composition is known; no real Comic Vine cold/warm search trace, provider latency or volume-result equivalence was retained.

**Next meaningful test:** Capture actual first/later search and subsequent details with exact items/order/total/fallback, calls/cache/cooldown, and independent concurrent/cancelled consumers.

**Disposition:** Issue titles/artwork may depend on enrichment. Merely parallelizing same-origin paced calls or removing metadata can alter results and gives no verified wire-time gain. Reasons: behavior contract to preserve or resolve; positive actual cohort/trace gap.

**Overlap:** PJ-14, FRT-01. Do not count shared repair gains twice. Original options and evidence: [providers-jobs.md](providers-jobs.md).

### PJ-05 — one Trakt value can require a full account walk

**Status remains open. Shared owner:** Canonical Trakt complete traversal/staging/current-value owner.

**Minimal option:** Use exact supported lookups or existing durable authoritative traversal/staging to avoid repeating a full account walk for one value; keep terminal evidence and activity/generation fences.

**Actual evidence and gap:** Actual local history exists; no complete live Trakt personal history/removal trace or remote latency was captured.

**Next meaningful test:** Replay actual retained provider pages for first/middle/last/absent values, true terminal page, removal/activity/reconnect/lease changes and safe yield/resume; never infer absence from a prefix.

**Disposition:** Mutable remote history and authoritative negative evidence prevent a trivial LIMIT/cache shortcut. A shared resumable census adds recovery/freshness ownership. Reasons: behavior contract to preserve or resolve; larger option needs a concrete complexity plan; positive actual cohort/trace gap.

**Overlap:** PJ-06, PJ-12, DATA-12. Do not count shared repair gains twice. Original options and evidence: [providers-jobs.md](providers-jobs.md).

### PJ-06 — Trakt list delivery still rebuilds full identities and rewrites converged lists

**Status remains open. Shared owner:** Canonical Trakt batched identity and list/traversal delivery.

**Minimal option:** Batch exact canonical identity reads and skip only proven converged complete list snapshots at the existing Trakt list/traversal owner.

**Actual evidence and gap:** Actual snapshots have zero local lists; no complete large remote list or local/remote concurrent-edit capture.

**Next meaningful test:** Compare complete real rename/add/remove/reorder/converged lists, aliases/unsupported entries, uncertain create and concurrent edits under rollback/recorded provider replay.

**Disposition:** Identity batching is routine but must cover all scalar/list/projection callers. Broader write-phase or convergence behavior needs actual remote completeness and race evidence. Reasons: positive actual cohort/trace gap; behavior contract to preserve or resolve.

**Overlap:** DATA-03, DATA-12, PJ-05, PJ-12, UIC-04. Do not count shared repair gains twice. Original options and evidence: [providers-jobs.md](providers-jobs.md).

### PJ-07 — Jellyfin final reconciliation escapes page/transaction budgets

**Status remains open. Shared owner:** Existing Jellyfin scan progress plus queue checkpoints/intents.

**Minimal option:** Split reconciliation intent seed/enqueue/finalization into bounded set-based/keyset phases through existing queue/checkpoint owners, with commit-coupled cursors and fresh account/lease/policy fences.

**Actual evidence and gap:** Deployed snapshot has8,919 pending reconcile and2,867 pending delta jobs; this is not a causal throughput result. Current clone history is terminal, and enabled reconciliation/user lock spans are not measured.

**Next meaningful test:** Read actual eligible payload overlap/age/gates; replay natural finalization rollback on an isolated clone, compare exact intents/versions and crash/resume/withdrawal semantics with bounded statements/lock spans.

**Disposition:** Changing unsplit units requires replay-safe phases and publication completeness, not merely more workers. FEATURE-JOB-LEASE-OBS-06 guards only feature.reconcile raw cleanup chunks. It does not fence or change Jellyfin finalization and does not close PJ-07, PJ-09 or PJ-10. Reasons: actual measurement/equivalence gap; behavior contract to preserve or resolve; larger option needs a concrete complexity plan.

**Overlap:** PJ-08, PJ-09, PJ-15, DATA-07. Do not count shared repair gains twice. Original options and evidence: [providers-jobs.md](providers-jobs.md), [implementation-feature-job-lease.md](implementation-feature-job-lease.md), [deployed-real-sql.json](evidence/deployed-real-sql.json).

### PJ-08 — a single music track can materialize 10,000 listens in one transaction

**Status remains open. Shared owner:** Shared imported-listen persistence and existing import checkpoint owner.

**Minimal option:** Persist imported listens in bounded replay-safe batches under the current import checkpoint, preserving exact per-listen events, unknown dates, duplicates and webhooks.

**Actual evidence and gap:** Actual music/listen history exists; no actual10,000-listen positive delta was executed or measured.

**Next meaningful test:** Replay naturally retained actual source count deltas and compare every listen/session/provenance/webhook/cursor field, unchanged retry and concurrent listening; measure batch SQL/WAL.

**Disposition:** Replacing repeated listens with a cumulative representation changes history semantics; splitting exact events needs atomic resume/dedup ownership. No fabricated high-delta cohort may establish gain. Reasons: behavior contract to preserve or resolve; larger option needs a concrete complexity plan; positive actual cohort/trace gap.

**Overlap:** PR-05, PR-14, DATA-07, PJ-07. Do not count shared repair gains twice. Original options and evidence: [providers-jobs.md](providers-jobs.md).

### PJ-09 — final shared-library membership update rewrites matching parents and correlates child counts

**Status remains open. Shared owner:** Canonical membership-evidence projection.

**Minimal option:** Guard unchanged membershipComplete only at its canonical evidence scope; aggregate touched child counts once if actual plans justify it and keep finalization fencing.

**Actual evidence and gap:** Actual census3,618 parents/26 expected-member declarations/0 membershipEvidence/0 currently eligible parents; the26 computed values already match.

**Next meaningful test:** Wait for naturally valid current membership evidence, then compare complete parent/Collection flags, distinct children, partial-scan exclusion, tuple admission and safe plans in rollback.

**Disposition:** A value-difference guard is plausible but no positive current admission exists. Rebuilding provenance or seeding evidence solely to benchmark would fabricate the missing cohort. Reasons: positive actual cohort/trace gap.

**Overlap:** PJ-07, DATA-07, DATA-14. Do not count shared repair gains twice. Original options and evidence: [providers-jobs.md](providers-jobs.md), [implementation-provider-membership-census.json](evidence/implementation-provider-membership-census.json).

### PJ-10 — Jobs terminal representatives scan and spill permanent history

**Status remains open. Shared owner:** Shared queue task evidence/read model and scheduler index contracts.

**Minimal option:** Use a bounded complete dynamic/null task-key discovery and indexed representative owner; if necessary stage a durable latest-task model with explicit write/rebuild/retention semantics.

**Actual evidence and gap:** Actual permanent history plans show sort/spill cost. A later read-only hash-group alternative preserved23 representatives including4 null scopes but still sorted25,891 rows and doubled hits669→1,338; it was rejected.

**Next meaningful test:** Compare complete task IDs/counts/current/null/obsolete generations/ties/old one-offs and actual default-setting plans, then index/write overhead or maintained-projection recovery if selected.

**Disposition:** A closed serviceTasks list loses dynamic/null representatives. The tested SQL is not a gain; a new index/projection is a substantive schema/write-maintenance option, not authorized by this disposition. Reasons: actual measurement/equivalence gap; behavior contract to preserve or resolve; larger option needs a concrete complexity plan.

**Overlap:** PJ-15, PR-14, MIN-05. Do not count shared repair gains twice. Original options and evidence: [providers-jobs.md](providers-jobs.md), [deployed-real-sql.json](evidence/deployed-real-sql.json), [development-real-sql.json](evidence/development-real-sql.json).

### PJ-12 — list conflicts have no page bound and hydrate complete local membership per conflict

**Status remains open. Shared owner:** Shared conflict projection and bounded summary/detail requests.

**Minimal option:** Return bounded conflict summaries, demand-load the complete selected list diff, and share batched canonical membership/identity projection.

**Actual evidence and gap:** Captured actual installations contain no saved lists; no large positive list-conflict/provider response was retained.

**Next meaningful test:** Compare naturally retained actual scalar/list conflicts, exact ordered unsupported membership, selected huge diff, local edits/privacy/acknowledgement and bounded summary admission.

**Disposition:** Complete approval evidence cannot be silently capped. Paging/summary/detail contracts must remain coherent with the approved review interface. Reasons: positive actual cohort/trace gap; behavior contract to preserve or resolve.

**Overlap:** UIC-04, PJ-05, PJ-06, UIS-03. Do not count shared repair gains twice. Original options and evidence: [providers-jobs.md](providers-jobs.md).

### PJ-13 — review pagination refetches invariant TMDB detail and credits

**Status remains open. Shared owner:** Shared catalogue insights/cache.

**Minimal option:** Separate invariant TMDB detail/credits from requested review-page demand inside the existing catalogue cache, preserving language/region/identity/retry behavior.

**Actual evidence and gap:** Actual screen catalogue exists, but no saved real review navigation/provider trace proves redundant calls in cold/warm usage.

**Next meaningful test:** Record actual consecutive review pages and compare full review/detail output, provider calls/cache entries and incomplete/error retry; retain Trakt-specific behavior.

**Disposition:** This can be a routine shared-cache composition change once invariant lookup ownership is demonstrated. Do not add a second cache or assume current cache misses/wire latency. Reasons: routine candidate; meaningful verification still pending; actual measurement/equivalence gap.

**Overlap:** DATA-04, PJ-14. Do not count shared repair gains twice. Original options and evidence: [providers-jobs.md](providers-jobs.md).

### PJ-14 — queued provider time has no caller deadline

**Status remains open. Shared owner:** Common request priority/transport/deadline/shared waiter owner.

**Minimal option:** Define caller-aware overall queued+active deadlines in the common priority/transport owner, with distinct local expiry, per-waiter ownership and durable continuation semantics.

**Actual evidence and gap:** Queued wait distributions and natural stuck incidence are unmeasured; existing queue128 and cancellation/admission bounds already work.

**Next meaningful test:** Use actual interactive/job provider traces plus controlled held queues; verify expired-before-send zero transport, follower survival, fairness/reservations/Retry-After and durable resumption.

**Disposition:** A blanket timeout changes long import behavior and ambiguous acknowledgement. Deadline values and recovery policy cannot be invented from source alone. Reasons: behavior contract to preserve or resolve; larger option needs a concrete complexity plan.

**Overlap:** PR-02, PJ-03, PJ-04, PR-04. Do not count shared repair gains twice. Original options and evidence: [providers-jobs.md](providers-jobs.md).

### PJ-15 — bulk task controls select all matching jobs and execute serial transactions

**Status remains open. Shared owner:** Existing queue task-control admission/selection/progress with canonical cancel/retry/promote policies.

**Minimal option:** Use bounded keyset chunks and a finite command budget in existing task-control admission, with a validated original target/generation boundary and exact updated/skipped/failed continuation.

**Actual evidence and gap:** Actual deployed pending backlog exists; per-control eligible count, clone mutation/lock/WAL and live busy-navigation behavior are unverified.

**Next meaningful test:** First read actual eligible scopes/counts; then clone-only cancel/retry/promote with dynamic/null scopes, auth/generation/active conflicts, notifications/priorities, lost acknowledgement and no newly created work swept in.

**Disposition:** Necessary per-job effects cannot be replaced with a broad UPDATE. Partial completion/recovery and whether work survives navigation require one concrete command contract, not card-private loops or a second scheduler. Reasons: behavior contract to preserve or resolve; larger option needs a concrete complexity plan; actual measurement/equivalence gap.

**Overlap:** PJ-07, PJ-10, PR-02. Do not count shared repair gains twice. Original options and evidence: [providers-jobs.md](providers-jobs.md), [deployed-real-sql.json](evidence/deployed-real-sql.json).

## Playback, music, parties and reading

### PR-02 — Hung control report blocks Stop and queues lifecycle events

**Status remains open. Shared owner:** Common API request lifetime plus existing ordered report and bookmark writers.

**Minimal option:** Bound ordered report/bookmark delivery and release local decoder/media ownership independently of its final persistence acknowledgement, preserving recoverable unsaved state.

**Actual evidence and gap:** Actual audio/video and23-page CBR happy lifecycles exist; held-send mechanism is controlled, not an observed natural outage or measured incidence.

**Next meaningful test:** Controlled held/late/ambiguous start-pause-seek-stop plus actual decoder/HLS release and exact played-time/bookmark equivalence; prevent old replies affecting a replacement.

**Disposition:** A routine timeout alone cannot decide idempotency, retries, lifecycle ordering or unsaved feedback. Durable client outbox is an optional larger requirement, not the default fix. Reasons: behavior contract to preserve or resolve; larger option needs a concrete complexity plan.

**Overlap:** PJ-14, UIC-03, PR-14. Do not count shared repair gains twice. Original options and evidence: [playback-readers.md](playback-readers.md), [playback-resource-probes.json](evidence/playback-resource-probes.json), [playback-resource-probes.ts](evidence/playback-resource-probes.ts).

### PR-05 — Serial rich music persistence and per-source page growth

**Status remains open. Shared owner:** persistMusic and existing page-observation operation.

**Minimal option:** Skip unchanged meaningful music metadata/structural work and batch page access observations under current account fences and deterministic locks.

**Actual evidence and gap:** Real music/provider mappings exist; no captured real50/60-item provider page was replayed cold and unchanged with SQL/WAL measurement.

**Next meaningful test:** Capture/replay one actual page in rollback; compare complete releases/tracks/occurrences/access/artists/artwork and cancellations/reconnects, then changed versus unchanged updates/queries/revisions.

**Disposition:** Repeated tracks/releases and access freshness are meaningful. A page transaction/refactor needs canonical lock/occurrence semantics, not a blanket timestamp no-op. Reasons: behavior contract to preserve or resolve; larger option needs a concrete complexity plan; positive actual cohort/trace gap.

**Overlap:** DATA-07, PJ-08, DATA-09. Do not count shared repair gains twice. Original options and evidence: [playback-readers.md](playback-readers.md), [development-real-sql.json](evidence/development-real-sql.json), [deployed-real-sql.json](evidence/deployed-real-sql.json).

### PR-06 — EPUB preflight and assets scale with full expanded archive

**Status remains open. Shared owner:** Verified EPUB archive preparation and engine-loading boundary.

**Minimal option:** Move existing verified EPUB preflight into an owned cancellable worker, then evaluate on-demand resource preparation only if actual expanded bytes/first-page work still warrant it.

**Actual evidence and gap:** No actual EPUB is supplied; installed-library/control proofs establish work shape, not real archive resource usage.

**Next meaningful test:** Actual ordinary/large EPUB first page/chapter/font/CSS/CFI/protection tests with expanded-byte/long-task/worker/heap counts and close-during-decode cancellation.

**Disposition:** Worker/resource transfer and archive hardening are substantive format/lifetime work. Do not replace the engine or add dependencies without evidence and the explicit dependency/complexity decision. Reasons: positive actual cohort/trace gap; larger option needs a concrete complexity plan.

**Overlap:** PR-01, PR-09, UIS-07. Do not count shared repair gains twice. Original options and evidence: [playback-readers.md](playback-readers.md), [playback-resource-probes.json](evidence/playback-resource-probes.json), [playback-resource-probes.ts](evidence/playback-resource-probes.ts).

### PR-08 — Room wide reconciliation per participant heartbeat

**Status remains open. Shared owner:** Shared roomState and party command/read model.

**Minimal option:** Measure roomState, then separate participant liveness from repeated room reconciliation while retaining fresh authority/policy checks and exact command/read results.

**Actual evidence and gap:** Thirty-nine retained rooms do not establish active1/8/16-client or200-track contention; active-party scale is absent from current evidence.

**Next meaningful test:** On naturally active parties compare full room/host/buffer/ready/queue/privacy/generation/disconnect behavior, SQL/lock spans/payload and command latency; controlled interleavings supplement actual clients.

**Disposition:** Revision-keyed room state or event delivery adds ownership/backpressure/authority semantics. No party-private cache or polling redesign is justified merely by retained row count. Reasons: positive actual cohort/trace gap; behavior contract to preserve or resolve; larger option needs a concrete complexity plan.

**Overlap:** PLAN-10, PJ-14, PR-02. Do not count shared repair gains twice. Original options and evidence: [playback-readers.md](playback-readers.md), [development-real-sql.json](evidence/development-real-sql.json), [deployed-real-sql.json](evidence/deployed-real-sql.json).

### PR-09 — Reading range/HEAD metadata authorization amplification

**Status remains open. Shared owner:** ownedReadingSession and streamReading verified request context.

**Minimal option:** Reuse the exact already verified Jellyfin connection/context within one stream request and narrow its repeated projection; preserve fresh validation on every separate Range/HEAD request.

**Actual evidence and gap:** A real CBR opens/turns/minimizes/resumes/closes; no complete actual PDF/EPUB Range/HEAD metadata-to-byte fanout trace exists.

**Next meaningful test:** Capture actual linked-file GET/HEAD/ranges and compare exact bytes/status/MIME/range/fingerprint behavior and reconnect/revocation/file-change rejection, counting duplicate metadata/credential reads.

**Disposition:** Current ownedReadingSession then streamReading resolves Jellyfin twice. Same-request reuse is routine if the verified context contract is explicit; cross-request capability/coalescing is a different freshness/privacy design. Reasons: routine candidate; meaningful verification still pending; positive actual cohort/trace gap.

**Overlap:** PR-06, PJ-14, DATA-09. Do not count shared repair gains twice. Original options and evidence: [playback-readers.md](playback-readers.md).

### PR-13 — Post-decode comic dimension guard cannot bound peak allocation

**Status remains open. Shared owner:** Common comic image admission and existing PDF renderer owner.

**Minimal option:** Inspect supported image dimensions in bounded headers before decoding, retaining the post-decode guard and shared cleanup; define cross-format pixel/frame policy.

**Actual evidence and gap:** Actual CBR image1,988×3,057 exists; no actual oversized scan/PDF failure or decoder allocation trace was captured.

**Next meaningful test:** Replay real scanned/compressed pages and PDFs; verify preallocation rejection, dimensions/orientation/animation, long tasks/peak memory and close/reopen release.

**Disposition:** A parser/header bound and decoder/resize policy must handle every supported format. Compressed bytes and one successful page do not select a truthful universal pixel cap. Reasons: positive actual cohort/trace gap; behavior contract to preserve or resolve; larger option needs a concrete complexity plan.

**Overlap:** UIS-07, UPP-02, PR-06. Do not count shared repair gains twice. Original options and evidence: [playback-readers.md](playback-readers.md).

### PR-14 — Evidence/session growth and history late page plans

**Status remains open. Shared owner:** Existing retention operation and shared history/session query projections.

**Minimal option:** Capture actual growth and late-page/session plans; add only plan-justified read/index improvements while preserving complete permanent history and newest-edition bookmarks.

**Actual evidence and gap:** Actual watch/listen/playback/reading evidence exists. No fully verified growth curve, all late-page plans or archival requirement.

**Next meaningful test:** Read-only actual cardinality/plans/buffers and first/deep page equivalence; any proposed index must measure write overhead and history/bookmark completeness.

**Disposition:** Permanent history is deliberate, not a leak. Deletion/archival changes retention semantics; routine plan measurement needs no approval or fake rows. Reasons: actual measurement/equivalence gap; behavior contract to preserve or resolve.

**Overlap:** PJ-10, PLAN-02, PLAN-09, PJ-08. Do not count shared repair gains twice. Original options and evidence: [playback-readers.md](playback-readers.md), [development-table-stats.json](evidence/development-table-stats.json), [deployed-table-stats.json](evidence/deployed-table-stats.json), [development-real-sql.json](evidence/development-real-sql.json), [deployed-real-sql.json](evidence/deployed-real-sql.json).

## Shared UI, preview, charts and diagnostics

### UIS-03 — append retains all loaded items and card owners

**Status remains open. Shared owner:** Canonical Shelf/source pagination and retained-card policy.

**Minimal option:** Choose a shared retained-page/card window with complete adapter cursors/occurrence identity and stable visible anchors, or an explicit supported backward-reload/page contract.

**Actual evidence and gap:** Actual large initial pages and short detail cycles exist; no20-page natural retained browse/DOM-resource plateau proof was captured.

**Next meaningful test:** Actual1/5/20-page browse across available media: complete order/occurrences, Back/anchor/menu/focus/keyboard/privacy and bounded DOM/observers/images/retained owners.

**Disposition:** Windowing can change approved Back/scroll/focus behavior and needs a complete retention policy. A component-private cap or silently dropping cards is not a routine safe fix. Reasons: behavior contract to preserve or resolve; larger option needs a concrete complexity plan; actual measurement/equivalence gap.

**Overlap:** DATA-04, UIS-04, PLAN-09, UIC-04. Do not count shared repair gains twice. Original options and evidence: [ui-second-pass.md](ui-second-pass.md).

### UIS-04 — card/shelf demand is latched after first contact

**Status remains open. Shared owner:** Shared MediaCard interaction and lazyContent/Shelf demand.

**Minimal option:** Measure offscreen refresh first; separate current-visibility/dirty refresh ownership from open menus and essential playback through the existing shared card/Shelf demand owner.

**Actual evidence and gap:** No actual offscreen HTTP/refresh or long retained-menu cohort was measured; source activation latches are confirmed.

**Next meaningful test:** Observe real unseen→visible→offscreen→revision→visible sequences plus open menu offscreen, keyboard/touch and immediate permission removal; count actual admitted reads and stale publications.

**Disposition:** Cancelling every offscreen owner can break active menus/playback or stale permission removal. Retain current policy if measured savings are small; do not add per-medium exceptions. Reasons: actual measurement/equivalence gap; behavior contract to preserve or resolve.

**Overlap:** UIS-03, UIC-01, DATA-04. Do not count shared repair gains twice. Original options and evidence: [ui-second-pass.md](ui-second-pass.md).

### UIS-06 — scheduling is shared, but native SVG still rebuilds and has no pixel budget

**Status remains open. Shared owner:** Shared liquidGlass action.

**Minimal option:** After measuring actual effective render keys, skip rebuilding an unchanged native glass map while retaining resize/DPR/theme/preference/quality/destroy behavior.

**Actual evidence and gap:** Shared scheduling is present; no actual frame/GPU cost or ineffective-key frequency was measured in the native enhancement path.

**Next meaningful test:** Capture actual render-key/update counts and real long browse/resize with every glass consumer; verify DPR/theme/reduced-transparency and release/visual identity before claiming CPU/GPU gain.

**Disposition:** An unchanged-key guard can be routine. Pixel caps, workers, disabled-map release policy or new caches are separate options needing measured demand and preserved quality. Reasons: routine candidate; meaningful verification still pending; actual measurement/equivalence gap.

**Overlap:** UIS-03, UPP-01. Do not count shared repair gains twice. Original options and evidence: [ui-second-pass.md](ui-second-pass.md).

### UIS-07 — avatar compressed-byte bound does not bound decode memory/lifetime

**Status remains open. Shared owner:** Shared avatar/image decode lifetime.

**Minimal option:** Use one shared cancellable image/decode owner with immediate late/error/supersession release and a concrete cross-format pixel/frame policy.

**Actual evidence and gap:** Actual small inline avatars exist, but no large/animated upload allocation/late-decoder trace or oversized real image was supplied.

**Next meaningful test:** Use actual formats/dimensions/animation, late success/reject, replace/remove/dispose and object URL release; measure retained decoded memory separately from compressed input.

**Disposition:** Image decoding may allocate before post-decode limits; choosing a browser API/parser/resize policy is not solved by copying a compressed-byte check. Preserve GIF/appearance semantics. Reasons: positive actual cohort/trace gap; behavior contract to preserve or resolve; larger option needs a concrete complexity plan.

**Overlap:** DATA-09, UPP-02, PR-13. Do not count shared repair gains twice. Original options and evidence: [ui-second-pass.md](ui-second-pass.md).

### UIC-03 — Grouped recommendation responses refresh once per recommendation ID

**Status remains open. Shared owner:** common API mutation acknowledgement and logical completion refresh.

**Minimal option:** Add one logical completion/refresh contract to the existing mutation acknowledgement owner: preserve every per-ID write/outcome, then refresh once including partial-success recovery.

**Actual evidence and gap:** The source loop is definite, but no actual pending multi-sender card operation was captured; one ID has no amplified refresh.

**Next meaningful test:** When a real grouped card exists, Save/Dismiss1/multiple IDs with partial server/refresh failure and target replacement; compare exact final states/acknowledgements and one completion refresh, across all consumers.

**Disposition:** Suppressing refresh inside one component without shared acknowledgement/recovery can misreport earlier committed writes. A batch endpoint is an alternative only with explicit atomic/partial-result semantics. Reasons: positive actual cohort/trace gap; behavior contract to preserve or resolve.

**Overlap:** DATA-06, PR-02, PJ-15. Do not count shared repair gains twice. Original options and evidence: [ui-components.md](ui-components.md).

### UIC-04 — Collection export preview returns full entries and mounts unbounded review panels

**Status remains open. Shared owner:** durable projection preview read DTO and shared bounded-review composition.

**Minimal option:** Expose bounded durable Collection preview summaries and demand-load complete selected review details through the shared projection/conflict owner.

**Actual evidence and gap:** Actual Collection membership exists; the captures have no saved list-conflict cohort or verified large export-review browser journey.

**Next meaningful test:** Compare full real preview approval evidence/ordered entries/totals under local edits, remote change/privacy and unsupported items; measure initial summary bytes and mounted selected detail owners.

**Disposition:** Approval must still see complete evidence. Do not silently truncate entries or redesign the approved review UI; summary/detail pagination needs one exact contract. Reasons: behavior contract to preserve or resolve; positive actual cohort/trace gap; larger option needs a concrete complexity plan.

**Overlap:** PJ-12, PJ-06, UIS-03, PLAN-06. Do not count shared repair gains twice. Original options and evidence: [ui-components.md](ui-components.md).

### UPP-01 — shared chart model lacks family work and generated-mark budgets

**Status remains open. Shared owner:** ChartModel/adapters and shared chart geometry admission contract.

**Minimal option:** Declare semantic input/work/generated-mark budgets at ChartModel/adapters, with truthful aggregation plus complete paged detail; validate invalid DAG/non-finite/unit inputs.

**Actual evidence and gap:** Current live adapters are bars/donut/target; complex reference families are finite fictional galleries. No actual packed/isotype/flow stall is verified.

**Next meaningful test:** Feed actual medium/experiment distributions through shared adapters; preserve totals/order/selection/table completeness and measure geometry/marks/long tasks/heap; controlled invalid semantic inputs protect the contract.

**Disposition:** Do not infer production slowness from worst-case source bounds or silently cap data. Spatial indexing/workers or alternative packing require actual demand and a concrete complexity choice. Reasons: behavior contract to preserve or resolve; actual measurement/equivalence gap; larger option needs a concrete complexity plan.

**Overlap:** PLAN-08, UPP-02, UIS-06. Do not count shared repair gains twice. Original options and evidence: [ui-preview-platform.md](ui-preview-platform.md).

### UPP-02 — custom preview JSON and image imports bypass finite fixture bounds

**Status remains open. Shared owner:** Preview data admission and shared local-image/decode ownership from UIS-07.

**Minimal option:** Define accepted custom JSON/event-preview bounds and reuse the shared decoded-image/cancellation owner for local preview backgrounds, preserving accepted configurations losslessly.

**Actual evidence and gap:** No actual large imported JSON/image stall or ordinary preview leak is demonstrated; existing gallery fixtures are not performance cohorts.

**Next meaningful test:** Replay actual saved user configurations/images; compare exact accepted edits/copies and explicit rejection, bounded event formatting and URL/decode release on replace/close/error.

**Disposition:** Input/large-data inspection limits need a truthful acceptance policy. Off-thread parsing is optional and should follow actual workflow evidence; no separate preview image algorithm. Reasons: behavior contract to preserve or resolve; positive actual cohort/trace gap.

**Overlap:** UIS-07, UPP-01. Do not count shared repair gains twice. Original options and evidence: [ui-preview-platform.md](ui-preview-platform.md).

### UPP-03 — bounded diagnostic store repeats filesystem and full-tail parsing work

**Status remains open. Shared owner:** DiagnosticStore for normal and runtime sample persistence.

**Minimal option:** Trace actual DiagnosticStore I/O, then initialize private-directory permissions and maintain segment-byte accounting once per valid directory lifetime with missing/external-change/error recovery.

**Actual evidence and gap:** Storage is already bounded4MiB/128 pending; no actual event-rate/disk bottleneck or repeated viewer trace proves current cost.

**Next meaningful test:** Compare actual normal/trace sessions and viewer refreshes for I/O/pending/drops/CPU; preserve permission failures, external rotation, retention/order, safe fields and separate runtime history.

**Disposition:** Initialization/accounting may be routine when recovery is specified. Append batching trades crash-tail durability and a new logger/database is not justified. Reasons: routine candidate; meaningful verification still pending; actual measurement/equivalence gap; behavior contract to preserve or resolve.

**Overlap:** UIS-02, PJ-10. Do not count shared repair gains twice. Original options and evidence: [ui-preview-platform.md](ui-preview-platform.md).

## Maintenance and completion boundary

At implementation, re-enumerate all consumers of the changed shared owner and compare complete actual outputs/state, not only the first card or a count. Retain exact source/runtime/session settings, meaningful correctness failures, query/process/row/byte bounds, original samples and missing cohorts. Preserve privacy/generation/lease/revocation and acknowledgement boundaries; cancellation of disposable reads must not silently abandon acknowledged writes.

A passing targeted test does not close an entire workstream. Record the exact repaired slice in the maintained ledger, keep overlapping/open options visible, and perform coordinated full gates and source-stable normal-dev acceptance. Read-only measurement and routine fixes can continue under the existing authorized scope; only the concrete dependency/unavoidable-complexity choices invoke the AGENTS.md question rule. No timer or default answer is attached to a user decision.

The provider/jobs agent independently reviewed the PJ/UPP dispositions. Its one material clarification is included: the feature.reconcile cleanup lease guard does not change Jellyfin finalization or close PJ-07/09/10. Current source fingerprints were refreshed after the separate OBS07 caller repair stabilized; that observation does not close any of these46 records or the SvelteKit proposal.

All owned disposition/report writes are frozen after publication.
