# Discovery, Search and For You audit

Date: 2026-10-15. Reviewed the current working tree, including new untracked modules. This is an engineering audit; no application changes, live requests, database operations, credentials, service startup or browser sessions were performed by this section.

## Scope and method

Substantively read all assigned Search/Discover/For You/planning route loaders and pages, the three corresponding Shelf sources, `search.ts`, `discovery.ts`, every `recommendations/` and `experiments/` module, and search/discovery/home queries. Traced direct catalogue search/discover calls, game identity/availability presentation, API dispatch, content revisions, resource cancellation, Shelf settling, and page/modal detail enrichment. Reviewed the organisation, architecture and performance guides. The full file inventory, with partial/scanned boundaries separated from substantive reads, is in `05-discovery.json`.

Ran seven focused non-DB test files: **22 tests passed, 0 failed, 150 assertions**. Two additional harmless inline reproductions exercised actual game-card presentation and compiled Discover/resource Svelte rune modules using an injected fake API. The initial Discover harness required replacing SSR lifecycle registration with a test stub; the corrected harness reproduced the cache problem. Read the parent's disposable-DB run log to triage two existing assertion failures; those runs were performed by the parent, not this reviewer.

## Healthy patterns and coverage

- Organisation matches the current guides: recommendation evidence, jobs, queries, wording and feed composition live together; gated planning/modal exploration remains in `experiments`. Existing `/api/v1/experiments/*` paths are intentionally preserved.
- Search shares bounded, punctuation-safe ranking and stable ties. Indexed local candidates render before streamed providers. Broader provider fallback is attempted only after a successful empty response; failure paths preserve local data. Owner-scoped aliases remain scoped in the inspected SQL path.
- The current Reading kind gates and provider-result filters are present. This audit does **not** repeat the earlier reading-kind/filter reports without a surviving path.
- Reading Search resolves provider identities/cards together; Discover's game path already resolves registered IDs and availability in a batch. Partial reading/provider failures retain usable cards and notices.
- For You's initial loader fetches only hero/next action and skips that work for section grids. Progress and recommendation cards remain separate lazy sources.
- DynamicFeed asks for `limit=1`, blocks another definition while its appended Shelf is unsettled, and places the sentinel after existing rows with `rootMargin:0px`. Empty settled rows can disappear and allow another definition. This supports the intended one-row-at-bottom semantics statically; browser network/viewport proof remains unverified.
- Feed order and wording are deterministic within a visit. Titles distinguish saved/liked/exploratory evidence. Row title links preserve work/genre/kind/reason/seed.
- Personal recommendation reads check connection status, account generation and enabled instance; cached taste scores contribute only when the current revision matches. Provider refreshes use existing scheduling/checkpoints, freeze seed batches, guard account changes and job leases, and avoid live provider calls from recommendation page reads.
- Planning validates ownership, future bounds, friend relationships and enabled media; caps plans under a per-owner transaction lock and schedules reminders through the existing outbox. Completion/cancellation scope writes to the owner.
- Modal initial data and optional enrichment share the page service. Saved details survive metadata failures; the component aborts superseded initial/enrichment delivery. Shared resource tests protect stale response/cancellation behavior.

## Prioritized findings

### DISCOVERY-01 — P2 — Unified Search repeats registered games as unavailable provider results

**Strong static evidence; presentation effect reproduced.** `src/lib/server/queries/search.ts:117` obtains canonical local game cards, but lines 131–135 map every remote result using the raw IGDB ID and remote URL without resolving `game_external_ids`. `src/routes/search/+page.svelte:21` concatenates local and remote cards. `src/lib/games/presentation.ts:26` defaults remote availability to false.

A registered Steam-owned game returned by IGDB therefore appears both in Available under its Coast UUID and in Unavailable under its IGDB ID. Unowned registered games appear twice in Unavailable; multiple IGDB instances multiply the duplicates. Registered games outside the first local 60 can be shown only as unavailable even when owned. The pure fixture produced two cards for the same title with different IDs/links and opposite availability flags.

**Minimal correction:** batch-resolve the bounded IGDB result IDs and prefer canonical viewer-scoped cards before deduplicating the combined results. Discover already does this at `src/lib/server/queries/discovery.ts:66`; reuse that approach without importing detail metadata for every Search card.

**Verification:** a disposable game fixture with a canonical IGDB identity, viewer Steam ownership and stubbed IGDB search should yield one available card with a canonical link. Repeat with two instances and a match outside the local first page.

### DISCOVERY-02 — P2 — Discover's local cache survives source and content changes

**Confirmed with compiled source fixture.** `src/lib/ui/shelves/discovery.svelte.ts:23` keys successes only by surface/kind/page. Lines 35–38 return cached success even for an explicit load. The initial-prop effect at line 53 only refreshes the original surface; other cached surfaces survive. Feature withdrawal handling at line 61 covers Reading but leaves selected Listen/Play content.

After loading Listen, switching to Watch, applying refreshed props/context, and switching back to Listen, the compiled current module made **one request total** and returned its original `available:true` music item. No revision or source change invalidates that success. In the actual mounted Discover shelf this means provider disconnection, availability updates or disabled music/gaming can leave stale results and available flags until remount. This is a presentation/freshness finding; it does not establish a playback authorization bypass.

**Minimal correction:** use the existing viewer/content revision key, invalidate affected current/cached content, refetch only activated shelves, and reset disabled Listen/Play selections as Reading already does. Preserve unchanged-session caching.

**Verification:** source test covering unchanged session, changed tracking/social revision, source revocation, and medium withdrawal. A changed context must cause a fresh request or clear withdrawn content; returning to a cached medium must not restore old flags.

### DISCOVERY-03 — P2 — Recommendation candidate cutoff can discard every relevant match

**Strong static evidence; DB repro not executed by this section.** `src/lib/recommendations/query.server.ts:44` admits all otherwise eligible category works for general/seed rows. Line 53 limits to 2,000 by provider score, fresh taste score and UUID. Genre/author/series evidence is applied only at line 55, and nonpositive results are removed at line 56.

When a user has no fresh taste scores or provider matches, the first 2,000 candidates are effectively a UUID slice. If those are unrelated and relevant works fall beyond the cutoff, the row returns zero even though relevant works exist. This affects new users and users immediately after a taste-changing action. Author/series-only reading matches have the same ordering problem. No claim is made about production incidence or measured query latency.

**Minimal correction:** retain bounded loading but choose candidates using positive evidence before the cutoff, drawing on existing indexed feature/genre candidate selection. Preserve provider and valid taste matches without genre overlap. Avoid an unbounded application-side catalogue scoring pass.

**Verification:** disposable DB with a favourite Drama seed, 2,000 eligible lower-UUID Comedy movies, one higher-UUID Drama movie, no provider sets and no taste scores. General recommendations should contain the Drama movie; the present query selects then rejects only Comedy rows. Also cover author/series-only matches and stale taste revisions.

### DISCOVERY-04 — P3 — Two DB assertions retain previous Search/taste contracts

**Confirmed failure evidence from the parent's run.** `tests/domain-application-db.test.ts:1024` assumes an unavailable shared show is absent for another viewer, relying on the previous cutoff ordering. The current authenticated Search intentionally includes shared unavailable metadata and orders SQL relevance before UUID (`src/lib/server/queries/media.ts:143`). Seeing that show's metadata is not evidence of a source/privacy leak. The following `every(!available)` assertion protects the relevant grant boundary.

`tests/taste-cache-db.test.ts:22` expects four profiles; `src/lib/social/taste-cache.server.ts:61` now deliberately writes six media profiles, including book/comic. The parent's log records four expected and six received. This early assertion prevents the test reaching its later stale-cache score checks.

**Minimal correction:** assert no availability/source grant rather than arbitrary metadata exclusion, and verify the explicit six profile media instead of four. Retain all ranking, truncation, revision and private-score assertions. Rerun both suites against disposable databases.

## Uncertainties and limits

No end-to-end browser lifecycle or live provider behavior was exercised. Recommendation cutoff impact is a deterministic SQL-path argument awaiting its described DB fixture; the Search identity gap was reproduced through real presentation functions rather than DB/provider mocks. Generic Shelf layout, provider HTTP internals and broader social taste implementation are separate review areas. No runtime proof of a privacy exploit, leak, pool starvation or unbounded memory growth is claimed.

## Minimal ordered recommendations

1. Resolve/deduplicate game provider Search identities using the existing Discover pattern.
2. Give Discover's existing bounded cache the same revision/context lifecycle used by other Shelf sources.
3. Select positively relevant recommendation candidates before applying the existing cap; retain all current privacy and freshness gates.
4. Correct the two stale DB assertions, then run the focused disposable suites and the meaningful regression fixtures above.

Preserve the approved interface, existing API paths, lazy row semantics and current authorization/performance boundaries. No new framework, dependency or compatibility layer is needed for these corrections.
