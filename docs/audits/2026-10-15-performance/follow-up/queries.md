# Independent follow-up: catalogue, read models and API hydration

2026-10-15. Read-only follow-up against working-tree changes based on HEAD `ea01908654db7c0b4cf591028c7f9b321c6896dd`. Scope: catalogue/search/profile, Collection/Library/lists, social/notifications, reading/game/music read projections and their browser/public API consumers. Read `docs/performance.md`, the strengthened acceptance gates and current audit ledger, and the earlier independent data-read report. No production edits, services, containers, provider calls, database access, migrations, full test suite, check or build. Root coordinates all heavy verification.

## Confirmed remaining costs

### QF-01 — P2: selected-next sequence delivery still transfers the full sequence

Confidence: high for unnecessary result transfer/application materialisation; SQL execution time and memory impact unmeasured.

`src/lib/server/queries/media.ts:543–569` unconditionally calls `sequenceEntries` at line 549, including when neither `afterEntryId` nor `fromEntryId` is supplied. It scans this complete array to choose a single eligible entry and hydrates only that card. `sequenceEntries` projects every expanded leaf (`src/lib/core/lists/sequence.server.ts:103–111`). This is a live read path: `nextPlayable` delegates collection selection to it (`media.ts:574–575`), including the initial home hero (`src/lib/server/queries/home.ts:17`), media details (`media.ts:682`) and action menus (`src/lib/server/queries/media-actions.ts:80`). Explicit sequence API selection also calls this function (`src/lib/server/api/index.server.ts:200`).

The PERF-06 summary/next fix is present, but did not migrate this no-cursor consumer. The existing `nextSequenceEntries` service (`sequence.server.ts:131–143`) uses the same recursive definition, source validation, effective rewatch/event state and ordering, returning at most one entry per requested source. This is distinct from explicit full-sequence consumers that actually return every member.

Actual-function probe, with synthetic sequence and hydration boundaries:

| Expanded entries | Full sequence reads | Rows returned to caller | Bounded-next reads | Cards hydrated |
| --- | --- | --- | --- | --- |
| 1 | 1 | 1 | 0 | 1 |
| 300 | 1 | 300 | 0 | 1 |
| 3,000 | 1 | 3,000 | 0 | 1 |

The selected card is correct in all probes. These counts establish an unnecessary transfer slope, not a claim of 3,000 SQL queries, faster SQL execution, production latency or a leak. The existing bounded-next query still has to evaluate enough recursive/effective state in SQL; do not claim that its server work is independent of sequence size.

Smallest repair: for the existing no-cursor case, request this source through `nextSequenceEntries` and reuse the current one-card hydration/application. Retain the current full-sequence cursor/from-root semantics initially. In particular, `fromEntryId` intentionally has fallback behavior for selected nested roots and can choose an exact repeated entry even when the generic first-unwatched algorithm would not; it must not be routed blindly through the simpler next helper. Preserve a null result when all entries are complete/dropped, unavailable card behavior and source validation errors. No new loader, queue or cache is needed.

Required regressions: actual `sequenceNextView` returns the same complete normalized card/sequence for no-cursor movie/episode/nested collection, rewatches, repeated playlist entries, dropped ancestors, empty/all-complete sequences, unavailable leaf and unknown source. Assert the no-cursor path consumes one selected entry rather than a full sequence. Keep the existing `afterEntryId`, nested `fromEntryId` and stale-entry conflict tests. A small disposable DB comparison against the old complete-sequence oracle can verify the shared SQL semantics; root owns execution.

### QF-02 — P2: social badges transfer and resolve presence for every match before returning three per work

Confidence: high for transfer/materialisation/presence overwork; database plan cost unmeasured.

`src/lib/social/queries.server.ts:72–100` accepts at most 60 work IDs. Its friend query returns every permitted distinct matching row (`:88–96`) without a per-work projection bound. It then passes every row's user ID to `statusesForUsers` (`:98–99`), filters/maps the entire result once per requested work and only finally slices to three (`:100`). `statusesForUsers` deduplicates IDs before SQL (`src/lib/social/status.server.ts:33–38`), which prevents a duplicate presence row per work, but still reads all distinct matched friends even when only three friends appear in every work's result.

This runs for ordinary visible shelves through `src/lib/ui/components/Shelf.svelte:104–112` and the shared `social/works` API (`src/lib/server/api/index.server.ts:156`). Existing client batching of 60 IDs and two requests controls request concurrency; it does not control a batch's friend fan-out.

Actual `workSocial` function compiled in isolation, with generated already-authorized SQL result rows and mocked presence boundary:

| Requested works | Friends/work | Driver rows | Generated driver-result JSON bytes | Presence input IDs / distinct IDs | Friend objects returned |
| --- | --- | --- | --- | --- | --- |
| 60 | 3 | 180 | 44,251 | 180 / 3 | 180 |
| 60 | 30 | 1,800 | 443,701 | 1,800 / 30 | 180 |
| 60 | 300 | 18,000 | 4,454,401 | 18,000 / 300 | 180 |

Every output total and first-three identity/order is correct. Each generated avatar string is 128 bytes. Bytes are serialization of synthetic driver rows, not measured PostgreSQL protocol or HTTP response bytes. No SQL query-time, pool starvation or production memory claim follows from this probe.

Smallest shared repair: retain the current distinct authorized projection as the authoritative relation, aggregate its exact per-work total in SQL, rank by the current username ordering and return only the first three details per work plus the exact total. Presence then receives only the selected identities. Map the bounded results once rather than filtering the entire matrix for each ID. Preserve zero-match entries, reaction summaries and all current category, accepted-friend and `social_visible` checks before ranking/counting. Do not LIMIT the raw reasons or recursive descendants: that loses true totals and can remove the first visible friend. Do not change the current distinct-row counting contract to a distinct-user count without proving equivalence for cross-category descendants/privacy. Audit username ties and retain deterministic existing identity order; if usernames are guaranteed unique, capture that evidence.

The existing database still needs to count all matching authorized evidence. The repair bounds transferred detail and application/presence work; query plans are required before making a broader database-work claim or adding indexes.

Required regressions: 0/1/3/4/large friends per work across 1 and 60 requested roots; different matching friends per root; repeated descendant reasons; ancestor-collected reasons; reading/music/game evidence; reactions and status expiry/invisibility; private sections, removed friendships, disabled media and users; exact totals and normalized first-three order compared with the old full relation. Assert at most three detail rows per root and presence queries only for selected users. Root should collect normal PostgreSQL plans using generated friends/relationships/history dimensions.

### QF-03 — P2: changing a profile insight period hydrates favourite/background cards that the response discards

Confidence: high; bounded avoidable work rather than an unbounded query slope.

The active profile period control invokes `profile/section?section=insights` at `src/routes/profile/[username]/+page.svelte:128–143`, specifically line 136. The signed-in handler (`src/lib/server/api/profile.server.ts:31–57`) calls the full `profileData` read with `view: 'overview'` at lines 39–49, then returns only `data.totals` and `profileActivity` at lines 54–56. The public-profile branch repeats the same pattern (`src/lib/server/api/index.server.ts:89–94`).

For this endpoint, `profileData` still reads profile presentation preferences (`src/lib/server/queries/profile.ts:78–87`), selects up to twenty favourites (`:170–197`), validates optional featured/background and pinned/favourite ordering (`:210–234`), hydrates the selected shared IDs (`:235–245`) and may separately select/hydrate activity background (`:255–264`). None of these cards or presentation fields is returned by the insight response. The existing shared card page can itself require sequence summaries and source/metadata hydration, so the twenty-card cap does not make this work free.

Probe compiles the actual `handleProfile` and actual `profileData` function bodies together. A generated owner with twenty favourites and no background/featured work causes **twenty IDs to be passed to real call-site card hydration**, while the final handler output keys are exactly `totals` and `activity`; no favourite cards are returned. SQL, privacy and card boundaries are mocked. This establishes the active call graph and discarded hydration, not its PostgreSQL timings or real privacy correctness.

Smallest repair: factor the existing totals/visibility projection into the shared profile owner and use it from both `profileData` and the insight-section handlers. The insight path should request the required counts/period aggregates and `profileActivity`, without activating profile artwork/favourites/featured hydration. An explicit small projection mode in that same owner is also viable if it avoids duplicating privacy/count definitions. Keep whole-page profile output and the approved period-control UI unchanged. Update both signed-in and public-profile branches; avoid a handler-specific cache or a parallel totals implementation.

Required regressions: compare complete normalized insight responses across month/year/all and private/public/friend audiences with the current implementation; preserve hidden insights rejection and category-specific totals. Verify actual period refresh does zero workCards/mediaViews/card-background hydration while full profile pages, favourites/history sections and fixed/activity backgrounds retain their outputs. Existing metadata precedence and visibility tests still apply. This reduces evidenced demand; no new API/UX is needed.

## Separate correctness/acceptance gap: guest detail membership still silently stops at 500

This is not counted as a performance fix, and should not justify arbitrary truncation or an unrequested redesign. `src/lib/social/public.server.ts:20` limits any explicit `publicMedia(ids)` read to 500. `publicDetails` additionally limits its mixed relationship/episode/season identity query to 500 without an ordering or continuation, and independently caps seasons (`:28–31`). The active guest `/media/[id]` route calls it at `src/routes/media/[id]/+page.server.ts:18`. A title with more than 500 authorized children cannot be fully represented, and the response has no paging/truncation indicator. `docs/domain-model.md:25` describes explicit detail membership batching as complete; the existing public-detail regression in `tests/review-followups-db.test.ts:32` covers one season, not that boundary.

Evidence is static contract reasoning; no guest large-catalogue DB fixture executed. Root should decide whether this belongs to current authorized completeness repairs or a separately tracked baseline defect. If addressed, reuse complete bounded explicit-ID hydration or an explicit truthful pagination contract; do not simply raise the single limit. Include 501+ episode/member/season cases, deterministic order and unchanged safe-public metadata/privacy.

## Measurement-gated opportunities and excluded duplication

- `screenProgressPlan` still selects all owner tracking rows and `continuationIds` reads eligible show episodes before final page selection (`progress.ts:157+`, `continuations.ts:67+`). This was already a prior candidate. Eligibility/rewatch/continuation semantics need complete evidence; no arbitrary early LIMIT is justified. Real owner-history and child-cardinality plans remain necessary.
- Social activity still groups authorized complete histories before final page selection. The already-parked grouping/projection redesign remains parked. Moving cursor/period predicates into raw events changes grouping, listen numbering, unknown dates and group identities.
- `nextPlayable` for show/season reads all child IDs then constructs an IN/CASE ordering before selecting one (`media.ts:576–611`). This is a statically visible avoidable intermediate identity list; an equivalent direct joined candidate selection could remove it, but no runtime/plan comparison was conducted. Keep it as a candidate separate from the confirmed sequence no-cursor repair.
- `detailsData` explicitly returns complete members/seasons/selected season episodes and parent-collection sequences (`media.ts:616–774`). Some overlapping parent collections independently hydrate the same union. A batched union may help, but full membership is part of this response and must not be truncated under a performance label. No independent fixture or cost claim here.
- Music browse/search invokes serial `observeMusicAccess` per provider item (`music/service.server.ts:10–15`); membership no-op repair is present, while metadata/provider/edition/artist upserts remain. Root assigned this remaining PJI-1 observation to the integrations follow-up auditor; it is deliberately not duplicated here.
- Notification inbox summary and page both evaluate visibility, and reaction hydration can repeat activity/card work (`server/notifications/inbox.ts:45–86`). SQL plans and generated notification cardinalities are needed before attributing a bottleneck. Current paging/order/summary snapshots and social visibility must remain authoritative. No cache proposed.
- No indexes, global caches, higher SQL concurrency, provider-lane changes or UI redesign are justified by this review.

## Checked positive patterns and coverage

| Owner / consumers inspected | Checked behavior |
| --- | --- |
| `collection/query.server.ts`, `queries/media.ts`, profile/progress consumers | Prior wide provider mapping fix uses only music IDs and narrow columns; screen caption/title metadata is reused; profile activity background reuses an existing card when available. Ordered workCards batches deduplicate fetch identities and preserve requested repeated order. |
| `core/lists/sequence.server.ts`, `queries/continuations.ts`, `queries/lists.ts` | Shared summaries and next reads batch at 60 sources. Selected playlist display limits expansion to selected entry roots. Source validation and recursive/event semantics remain shared. QF-01 identifies the remaining consumer, not a claim those fixes are absent. |
| Collection/Library/lists/profile/reading catalogue | Membership, privacy, enabled media and availability predicates generally precede counts/page hydration; deterministic bounded page selection is retained. Numbered OFFSET alone is not reported as a defect. Unused full `userLists` API remains the existing PERF-27 checked opportunity, not newly confirmed production fan-out. |
| `queries/search.ts`, `queries/search-ranking.ts`, `core/games/service.server.ts`, `reading/query.server.ts`, guest public search | Local search uses native indexed candidate predicates, bounded direct/prefix fallback and local-first provider streaming; private screen aliases stay owner-scoped. Provider game/reading identities resolve in batched local reads, not detail-import calls per search card. No search ranking/index execution claim without DB plans. |
| `games/presentation.server.ts`, `gamePresentationMetadata`, reading cards | Game variant presentation reads parents in one batch, retaining variant identity/title. Reading progress/availability hydrate only bounded selected pages, with category-specific visibility; shared workCards now chunks callers exceeding a page. |
| `server/public-api/{handler,library,progress}.server.ts` | Scope/category/input gates precede returned data; normal catalogue/library/progress use local read projections and bounded pages rather than provider browse calls. PublicProgress batches page identities and does not export private notes. Subscription listing now uses the established bounded page contract. |
| `server/config.ts`, `server/content-revision.server.ts`, route/layout callers | Config reuse is request-local with explicit connection reads kept fresh and detached-context cleanup. Content revisions read durable counters and finite peer/connection evidence rather than whole activity histories; no finding of repeated per-card revision reads. Scalar settings subqueries in raw SQL are not automatically one DB request per row; require plans. |
| `social/queries.server.ts`, `social/service.server.ts`, `social/insights.server.ts`, notifications inbox | Social privacy checks remain SQL authoritative; friend roster paging and overlap/detail evidence bounds exist. Exact counts still require aggregate work; QF-02 concerns unnecessary detail/presence transfer after that aggregate. Notifications are deterministically cursor-paged, not unbounded output. |

## Retained evidence and limitations

- Probe source: `/private/tmp/coast-criteria-queries-probe.ts`.
- Raw probe output and SHA-256 source identities: `/private/tmp/coast-criteria-queries-probe.json`.
- Executed command: `.tools/bun-1.4.3/bun-darwin-aarch64/bun /private/tmp/coast-criteria-queries-probe.ts` (exit 0).
- Runtime: pinned Bun 1.4.3. The probe compiles the current actual TypeScript function bodies, preserves their control flow and replaces only named external boundaries. It intentionally does not import/start the application, access PostgreSQL or contact providers. Fixture work IDs need not satisfy production UUID validation because the external validation boundary is mocked.
- No production data, secrets or diagnostic URLs appear in these artifacts. Generated examples only.
- These probes prove current control-flow work counts and synthetic serialization sizes. They do not certify PostgreSQL plans/locks, production latency, process memory, concurrent account permission changes, browser navigation or live providers. Root must perform the corresponding integration/privacy regressions and serial DB/build/browser gates after accepting any fixes.

## Accepted implementation follow-up

After the independent read-only report was delivered, the coordinator authorized implementation of QF-01/02/03 and the guest membership correctness repair. Those production changes are now present in the shared working tree; no schema/dependency/UI change was introduced.

- `src/lib/server/queries/media.ts`: no-cursor `sequenceNextView` calls the existing shared `nextSequenceEntries`; cursor/from-root behavior retains the full sequence path.
- `src/lib/social/queries.server.ts`: current distinct authorized friend relation is ranked/count-projected in SQL, returning at most three detail rows/root with exact totals, then presence and grouping operate on those selected details. `users_username_unique` (`schema.ts:79`, initial migration) makes distinct users' usernames unique; same-projection distinct/count semantics are unchanged.
- `src/lib/server/queries/profile.ts`: internal `profileSummary` + `profileTotals` serve full `profileData` and the new card-free `profileInsightsData` so privacy/count logic remains shared.
- `src/lib/server/api/profile.server.ts` and `src/lib/server/api/index.server.ts`: signed-in and public insight-section responses use that shared projection; other section handlers retain full-page behavior and input validation.
- `src/lib/social/public.server.ts`: explicit IDs deduplicate and hydrate in ordered 500-ID batches; explicit selected-parent child/season enumeration is complete. Default discovery remains bounded to 150; all public-safe metadata/state/artwork policies remain in the existing mapper. This applies the already documented complete explicit-detail contract, without introducing a new pagination architecture.
- `tests/read-projections.test.ts`: six runtime tests execute actual compiled owners with isolated I/O boundaries, covering next-selection demand/cursor behavior, exact social totals/selected presence, 1,001 guest IDs across 500/500/1 batches and private-art filtering, insight/full totals parity with zero extra card/preference reads, and endpoint reader selection.
- `tests/read-projections-db.test.ts`: four disposable integration tests prepared for the coordinator: exact social totals/ranks after privacy/removal with replayed driver-row bounds; guest 501 seasons + 501 episodes; owner/friend/guest insight parity across periods/private rejection; selected-next oracle equivalence and replayed one-row result.

Latest executed narrow command: `.tools/bun-1.4.3/bun-darwin-aarch64/bun test tests/read-projections.test.ts tests/media-details-enrichment.test.ts` — **8 passed, 0 failed, 52 assertions**. No DB suite, build, typecheck, full test suite or browser run was executed by this auditor. Coordinator should run `read-projections-db.test.ts` plus relevant existing `sequence-db.test.ts`, `social-db.test.ts`, `profile-db.test.ts`, `review-followups-db.test.ts` and card hydration gates as appropriate.

The original `/private/tmp/coast-criteria-queries-probe.json` records the pre-repair source hashes and counts. Its companion script was designed for that original control flow; use the new focused runtime tests for the repaired implementations rather than treating a current-source rerun with old mocked SQL rows as a before/after SQL plan measurement. Database transfer bounds remain subject to the coordinator's real disposable fixture verification.
