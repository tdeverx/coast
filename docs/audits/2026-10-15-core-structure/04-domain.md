# Domain audit: canonical state, catalogue and personal read models

## Scope and method

Reviewed the current working tree through direct source reads and caller tracing. This pass covers screen canonical identity/metadata, tracking/ratings/lists/profile commands, Collection/Library/progress/profile/requests read models, TMDB metadata/credits, relevant loaders, and the transactional sync boundaries reached by these commands. Reader/game-specific implementations and detailed Jellyfin caching remain with their assigned reviewers. This is an engineering audit; no application changes were made.

The JSON companion contains the complete read-versus-scanned inventory. The review followed docs/code-organization.md, docs/architecture.md and docs/performance.md, verifying their claims against implementation. Existing pure tests passed: **53 tests, 257 expectations, 0 failures in 10 files**. Three harmless in-memory executions of current function bodies confirm the identity-selection, progress-export and private-playlist-decoration failures; their database dependencies were replaced with fakes. No database, browser, live-provider, build or production performance validation was performed.

## Coverage and healthy patterns

- Concrete work identities and provider namespaces are generally preserved. Metadata snapshots, administrator overrides/locks and user presentation preferences have separate storage and an explicit pure resolver. Incoming identity locks are sorted, and no provider requests occur inside metadata-ingestion transactions.
- Collection reasons distinguish direct, inherited and member-derived membership; owner preferences and section/category visibility are applied separately from viewer availability. Empty tracking rows do not manufacture personal Collection membership. Collection, Library, saved lists, requests and profile pages count/filter before bounded visible-card hydration in their normal paths.
- Owned list mutations lock the parent list. Exact-permutation reorders reject missing/duplicate/cross-list entries. Shared ratings reject invalid steps, tracking retains historical play counts, and source event identities preserve import retry semantics.
- Main tracking/rating writes and their sync intents/outbox share transactions. Provider account generations and projection ledger attribution are retained. Trakt Collection cleanup requires versioned approval and revalidates remote evidence; uncertain delivery does not silently authorize deletion.
- Saved media details return before optional provider enrichment; provider outages preserve the saved result. Menus query local projections. Profile avatars have owner-scoped import choices, byte-signature checks, private local GIF serving and cleanup serialized with profile writes.
- No file-size-only or cosmetic reorganization finding is proposed. The retained issues are concrete behavior, privacy, identity or bounded-loading inconsistencies.

## Prioritized findings

### DOMAIN-01 · P1 · Repeated conflicting Jellyfin metadata creates a new canonical work each scan

**Category:** correctness. **Confidence:** confirmed.

**Trigger:** Two existing movies own conflicting TMDB/IMDb identifiers. Import a Jellyfin movie advertising both with isolateConflictingProviderIds=true, then import that same instance/item again during shared library refresh.

**Root cause and impact:** The second and every subsequent refresh create another UUID while the scoped external-ID mapping remains attached to the first isolated UUID. The provider item and future user-access/import paths move to the newer work; personal state and lists retained under the previous UUID stop matching the accessible item. This breaks canonical identity stability and accumulates duplicate records.

Evidence:

- `src/lib/catalogue/service.server.ts:94` — Third-party identifiers are iterated before the appended instance-scoped Jellyfin identifier.
- `src/lib/catalogue/service.server.ts:119` — Conflict isolation discards the selected mediaId, keeps only the Jellyfin identifier and breaks without looking up that identifier.
- `src/lib/catalogue/service.server.ts:158` — An unresolved identity creates another media/work; later external-ID insertion uses onConflictDoNothing at line 204.
- `src/lib/sync/jellyfin.server.ts:350` — Shared library ingestion enables conflict isolation and updates providerItems.mediaId to the newly returned work at line 371; knownItems reuse is only for userScope at line 571.
- `tests/provider-db.test.ts:193` — Existing isolation test checks its first ingestion, without a repeated ingestion assertion.

**Minimal correction:** Resolve and retain an existing instance-scoped Jellyfin identity before choosing an isolated identity. When provider aliases conflict, discard only the conflicting aliases, keep the established scoped work, and preserve the current ordered identity locks.

**Verification:** The exact identity-resolution block was executed in memory with mappings tmdb:one->A, imdb:two->B, jellyfin:instance:local->ISOLATED. It returned mediaId undefined and only the Jellyfin ID, selecting the new-record branch. Add a disposable DB regression that repeats the isolated ingestion and checks identical UUID, one scoped mapping, stable provider item, and retained personal tracking.

### DOMAIN-02 · P2 · Shared progress exposes the owner’s private playlist name and entry context

**Category:** security. **Confidence:** confirmed.

**Trigger:** Owner creates and starts a privately named playlist, saves progress for its next movie with that playlist sequence, and shares screen progress with a visitor. Visitor opens /progress?username=OWNER&view=watching&scope=all; the leak also works with collection visibility disabled.

**Root cause and impact:** An authorized progress visitor receives the private playlist title, playlist UUID and entry UUID, revealing list membership outside the owner-only list APIs. Sequence decoration also bypasses the final field redaction performed by mediaViews.

Evidence:

- `src/lib/server/queries/progress.ts:54` — A cross-profile watching request requires progress visibility, without permission to inspect private lists.
- `src/lib/server/queries/continuations.ts:136` — All started playlists for the owner are read, returning their private names, list IDs and entry IDs in sequenceNext.
- `src/lib/server/queries/progress.ts:170` — The cross-profile planner invokes owner-only continuationIds and retains its playlist context.
- `src/lib/server/queries/progress.ts:90` — After viewer-aware card hydration, applySequenceEntry attaches private source/entry IDs and the playlist title becomes captionSubtitle.
- `docs/behaviour.md:95` — Documents ownership enforcement for every custom-list content request.

**Minimal correction:** Keep private playlist planning/context owner-only. For another viewer, select permitted title-level progress without exporting private playlist source, entry IDs or captions; apply viewer redaction after any remaining sequence decoration.

**Verification:** Executed the current readProgressData and applySequenceEntry bodies in memory with a redacted public card and a private playlist context. The only permission check was progress/screen; output included caption Confidential playlist name and sequence {kind:playlist,id:private-list,entryId:private-entry}. Add a disposable DB test with owner-only lists, visible progress and hidden collection, plus the equivalent route/API request.

### DOMAIN-03 · P2 · Playback-position resets queue malformed Jellyfin progress delivery

**Category:** correctness. **Confidence:** confirmed.

**Trigger:** Reset a nonzero saved movie/episode position from its menu, reset a group, or submit a supported nonzero progress change through tracking while a mapped Jellyfin connection is connected.

**Root cause and impact:** Coast updates successfully and queues a durable job, but that job normally returns as a no-op because its desired position is one second. Nonzero edits also store a false zero progress intent; reset requests wait for some later eligible reconciliation instead of delivering through their own action. Job success therefore fails to imply delivery of the requested edit.

Evidence:

- `src/lib/ui/components/MediaActions.svelte:285` — The ordinary Reset playback position command sends action=progress and positionSeconds=0.
- `src/lib/sync/changes.server.ts:319` — trackWithExports passes a value only for favourite, omitting the progress position and duration.
- `src/lib/sync/changes.server.ts:198` — The helper creates a zero/zero progress intent from omitted values, while line 231 emits value=true.
- `src/lib/sync/changes.server.ts:342` — The bulk-reset path calls the same helper without a progress value or duration.
- `src/lib/sync/jellyfin.server.ts:858` — Delivery converts payload true to one second and returns without writing when that differs from current canonical progress.

**Minimal correction:** Pass the committed numeric progress position and duration from the tracking result to enqueueJellyfinChange, including bulk resets, and ensure progress payloads always serialize a number. Preserve the existing transactional intent/outbox and stale-state checks.

**Verification:** Executed exact helper/wrapper source in memory using a fake transaction: input progress 300/1800 produced intent {positionSeconds:0,durationSeconds:0} and payload {field:progress,value:true} without duration. Add disposable tests for direct zero/nonzero changes and bulk zero reset, asserting exact numeric payload and successful fake-adapter delivery.

### DOMAIN-04 · P2 · The metadata refresh menu action never gets a refresh target

**Category:** correctness. **Confidence:** strong-static.

**Trigger:** An administrator opens the actions menu of a registered TMDB movie, show, collection, season or episode.

**Root cause and impact:** refreshTarget is always null for ordinary database-backed screen cards, hiding the existing manual metadata-refresh action even when the title or parent show has a valid TMDB identity.

Evidence:

- `src/lib/server/queries/media-actions.ts:20` — Menu items and requestTarget come from mediaViewsForIds.
- `src/lib/server/queries/media-actions.ts:74` — refreshTarget requires target.tmdbId to be truthy.
- `src/lib/server/queries/media.ts:273` — mediaViews selects only mediaId for TMDB identities and stores presence in a Set; its card return does not assign tmdbId.
- `src/lib/server/queries/media.ts:765` — Only detailsData adds tmdbId afterward; mediaActionData does not use that path.
- `src/lib/ui/components/MediaActions.svelte:770` — Administrator Refresh title/show details is rendered only when the menu query returns refreshTarget.

**Minimal correction:** Populate the real external TMDB ID in the established card projection, or resolve refreshable identities explicitly in the menu query. Reuse the existing local batched identity read; do not make a provider call while opening menus.

**Verification:** Seed TMDB identities for movie/show/collection and a show identity for a season/episode; assert mediaActionData.refreshTarget resolves each direct/parent target and stays null for a native title. Existing menu tests do not seed a TMDB identity or assert refreshTarget.

### DOMAIN-05 · P2 · Release-date actions use stale fallback dates after metadata enrichment

**Category:** correctness. **Confidence:** strong-static.

**Trigger:** Create a title/episode with missing or incorrect release date through catalogue recovery/provider ingestion, then enrich its existing UUID with a correct TMDB date. An administrator release-date override presents the same discrepancy.

**Root cause and impact:** The UI can show a known release/air year while its date action is unavailable. A bulk air-date watch can skip all enriched episodes or use an obsolete original date. Collection, demand and projection release filters also read concrete fallback dates, so enrichment does not reliably change release eligibility.

Evidence:

- `src/lib/catalogue/maintenance.server.ts:49` — Missing TMDB catalogue identities are intentionally created with title/IDs only, leaving media.releaseDate null.
- `src/lib/catalogue/service.server.ts:158` — The concrete media releaseDate is set only when the canonical record is first created.
- `src/lib/catalogue/service.server.ts:239` — Subsequent complete/detail metadata writes update metadataSnapshots, without updating the fallback media date.
- `src/lib/server/queries/media-actions.ts:24` — releaseDate and hasReleaseDate use media.releaseDate rather than the date resolved for the visible title.
- `src/lib/core/tracking/service.server.ts:555` — Bulk onReleaseDate reads the same fallback column and removes leaves whose fallback date is null or future.

**Minimal correction:** Use one local effective release-date projection with the existing override/provider policy for operational date predicates and returned menu dates. Preserve provider snapshots and overrides; avoid fixing this by unconditionally overwriting higher-priority metadata or hydrating every candidate card.

**Verification:** In a disposable DB, ingest an undated episode, reingest the same identity with a past date and complete=true, then compare resolved card year/menu hasReleaseDate and bulk onReleaseDate event timestamp. Repeat with a corrected future date and administrator override. Assert date eligibility agrees across these paths.

### DOMAIN-06 · P2 · New provider episodes leave stored show and season completion stale

**Category:** correctness. **Confidence:** strong-static.

**Trigger:** Finish all currently known regular episodes of a show/season. A provider metadata refresh then adds another already released, unwatched regular episode without a personal tracking mutation.

**Root cause and impact:** The parent can remain watched with old totals, appear in Collection completed filters, and be excluded from incomplete demand despite its new next episode. Other queries such as Library dynamically inspect episode membership, causing contradictory completion between surfaces until another episode tracking write refreshes the parent.

Evidence:

- `src/lib/catalogue/service.server.ts:183` — Canonical episode insertion adds subtype membership without refreshing any existing parent tracking rows.
- `src/lib/catalogue/service.server.ts:303` — TMDB show refresh imports all seasons/episodes and marks metadata complete, without an aggregate refresh afterward.
- `src/lib/core/tracking/service.server.ts:347` — Parent totals/completion are recalculated only through refreshAncestors after personal tracking changes.
- `src/lib/core/media/service.server.ts:89` — Manual episode addition explicitly recalculates parent totals/watched for this same membership-growth case.
- `src/lib/collection/query.server.ts:203` — Collection completed predicates trust tracking_state.watched; ordinary cards also use stored completedEpisodes/totalEpisodes at media.ts:445.

**Minimal correction:** Refresh existing parent completion/total projections when canonical episode membership grows, preserving historical play counts, drop choices and watch events. Reuse the established aggregate rules and coordinate with current tracking transactions; the manual-add path provides an existing minimal pattern.

**Verification:** Seed a one-episode show and season, mark the episode watched, then ingest a second released episode through ingestMetadata. Assert show/season totalEpisodes=2 and watched=false, while playCount/history remain intact and Collection completed/demand agree with Library. Repeat with a special episode, which must not change regular completion.

### DOMAIN-07 · P2 · Available filmography pages hydrate the full registered filmography before paging

**Category:** performance. **Confidence:** strong-static.

**Trigger:** Open or paginate Library/Available credits for a prolific person whose hundreds or thousands of credits are already registered.

**Root cause and impact:** Every 24-card request loads full personal/metadata/artwork projections for the entire registered filmography, then discards almost all of them. Database work, allocations and concurrent hydration scale with total credits rather than the visible page. No production latency or memory threshold is claimed.

Evidence:

- `src/lib/catalogue/details.server.ts:95` — Library/available scope resolves all matching registered credit identities.
- `src/lib/catalogue/details.server.ts:111` — Every matching work is passed to mediaViewsForIds solely to test its available flag.
- `src/lib/catalogue/details.server.ts:128` — Counting and slicing to 24 visible credits happen only after the full card hydration.
- `src/lib/server/queries/media.ts:518` — mediaViewsForIds executes all 500-card batch hydrations concurrently; each hydration loads personal state, metadata, artwork and availability.

**Minimal correction:** Filter registered credit identities using the existing viewer-scoped permitted-availability SQL before counting/slicing, then hydrate only the selected 24 works. Keep provider/person response caching, kind-aware external IDs and visitor permissions unchanged.

**Verification:** Use a disposable fixture with 1,000 registered credits and several viewer-specific grants. Instrument hydration calls and assert no more than the visible 24 IDs are hydrated per request, while totals/page clamping and film/show identity collisions retain identical results.

### DOMAIN-08 · P3 · Creating a playlist with an initial reading work bypasses its membership rule

**Category:** correctness. **Confidence:** strong-static.

**Trigger:** POST /api/v1/lists with {name:Reading playlist,playlist:true,mediaId:BOOK_OR_COMIC_UUID}.

**Root cause and impact:** Creation succeeds with a member that the ordinary Add path forbids. Playback expansion ignores that reading member, producing a visible playlist item with no valid playback entry. This is a validation consistency issue, not a cross-user authorization bypass.

Evidence:

- `src/lib/core/lists/service.server.ts:38` — createList validates only that the initial work exists and inserts it directly at line 46.
- `src/lib/core/lists/service.server.ts:140` — addListItem checks the work category and rejects books/comics in playback playlists.
- `src/lib/server/api/lists.server.ts:19` — POST /lists passes the create payload to createList, exposing the inconsistent initial-member path.

**Minimal correction:** Apply the same category rule when creating a playlist with an initial member. Share the small existing validation if useful; preserve atomic create-with-initial-item behavior.

**Verification:** Add a disposable DB regression asserting book/comic initial playlist creation fails without leaving a list, while ordinary reading lists and screen/audio playlist initial members still succeed.

## Uncertainties and limits

- No application source, tests, config, roadmap or database was modified. No services were started; no real/live providers or credentials were accessed. Only the assigned report files were written.
- No database-backed tests, real PostgreSQL EXPLAIN, browser flows, builds or type checks were run by this reviewer. Root owns generated-file gates and any disposable DB evidence.
- Games-specific canonical activity, reader-specific writes/ingest, detailed Jellyfin cache/access proofs, Home/Search/Discover/recommendations, and social services beyond directly relevant visibility calls belong to other reviewers.
- Trakt Collection preview/approval/ledger/projection paths were read, including account checks and cleanup, but live remote races, provider acceptance and full traversal scale were not exercised.
- Coverage read lists files substantively examined; scanned lists partial/targeted evidence searches. Running a pure test file is not a claim that every test source in it was manually read.
- P1/P2 static findings include exact disposable reproduction steps; production latency, memory thresholds and live provider delivery are not claimed.

The identity, reset-export and progress-privacy findings include direct cross-domain traces and may overlap the Jellyfin/jobs/social reviews; combine by root cause while preserving these IDs. No independent Search result/privacy finding is asserted here. Reports from the prior audit were not treated as current evidence.

## Minimal ordered recommendations

1. Stabilize conflict-isolated canonical identities and stop private playlist context crossing owner/viewer boundaries. Add focused repeated-ingestion and independent-privacy cases.
2. Correct numeric progress intent/outbox parameters for direct and bulk resets, then restore locally computed refresh targets.
3. Make release-date decisions agree with effective metadata, and refresh parent aggregate projections after canonical episode growth. Preserve history, UUIDs, source precedence and existing transactional locks.
4. Replace full-filmography card hydration with permission-filtered identity selection before pagination; apply the existing playlist membership guard to initial creation.
5. Run the proposed focused disposable DB cases and an administrator menu/profile-progress browser acceptance pass. Retain existing privacy, paging, rollback and provider-account tests; no new dependency or framework is needed.
