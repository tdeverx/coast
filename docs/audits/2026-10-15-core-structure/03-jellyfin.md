# Jellyfin structure and behavior audit

## Scope and method

Reviewed the current working tree on 2026-10-15, including the renamed/untracked server modules. This is a read-only engineering review of Jellyfin adapters, account/provisioning entry points, screen catalogue reuse/access proof, personal bootstrap, full and incremental reconciliation, companion recovery, and stream/live observations. The companion repository was read only to check the actual protocol producer. No application changes, live providers, credentials, database connections, services, check/build commands, or publishing operations were used.

Substantive reads covered every file in `src/lib/providers/jellyfin/`, all four `src/lib/sync/jellyfin*` modules, and relevant portions of `sync/changes.server.ts`, `sync/values.server.ts`, `music/persistence.server.ts`, `catalogue/reading-files.server.ts`, `collection/query.server.ts`, `collection/freshness.server.ts`, `providers/connections.server.ts`, `providers/actions.server.ts`, `providers/task-timing.ts`, `social/provider-live.server.ts`, `application/streams.server.ts`, `sharing/streams.server.ts`, onboarding, tracking API, public mutations, and playback progress delivery. Read the organization, architecture, performance, and companion guides. Read the focused Jellyfin query/access/bootstrap/reconciliation/companion/music tests, reading import checkpoint test, stream job/live tests and pure active-stream tests. `provider-contracts.test.ts`, `provider-parity-db.test.ts`, developer stream fixtures, and broader maintenance/queue consumers were searched for related coverage rather than reviewed in full. JSON contains the path inventory.

Executed seven existing non-DB test files: **35 passed, 0 failed**. Additional harmless pure reproductions exercised the real value comparator/decision functions, stream presenter, and adapter with injected synthetic transport. Database consequences below are static traces, with exact disposable-fixture reproductions supplied; they are not claimed as database runtime validation.

## Coverage and healthy patterns

- Shared metadata and per-user availability remain separate. User pages reuse known canonical mappings and hydrate only missing identities in bounded batches. Screen snapshots omit personal state; music metadata explicitly strips it.
- Bootstrap traverses played/resumable/favourite unions before opening onboarding, and complete availability follows separately. Account generation and worker lease checks guard personal availability/reconciliation writes. Screen multi-edition observations are grouped once per canonical title.
- Screen census reuse checks token-owned identity, server identity/version, freshly read policy, real visible folders, supported location/source types, completed scan cardinality, source generation and expiry. Unknown restrictions/versions fall back to authenticated traversal. This remains deliberately limited to verified 10.10/10.11 behavior; the companion targets 12.1, where reuse falls back.
- Screen pages reject incoherent pagination and changed totals. Partial inventories preserve prior completed census provenance. Incremental screen reads do not advance full checkpoints and withdraw only explicitly requested missing IDs/sources.
- Companion cursor acknowledgement and follow-up insertion share a transaction. Sessions use a field whitelist, personal changes remain user-scoped, server deletion remains instance-scoped, and unsuccessful stream reads retain prior sessions. Stream observations are persisted and cards read cached bounded pages.
- The feature has specific owners (`access-proof`, `updates`, `stream-history`, playback reconciliation) rather than a new universal integration service. The remaining large sync module is not itself a finding. Correctness gaps below arise where music/reading and companion recovery diverge from already-established screen behavior.

## Findings

### JELLYFIN-01 — P2: Manual progress changes lose their numeric outbound value

**Confirmed source trace and pure comparator reproduction.** `trackWithExports` passes a value only for favourites (`src/lib/sync/changes.server.ts:318–324`); bulk progress reset omits it too (`:342`). The helper records progress intent as zero (`:198`), but queues `value: true` (`:231`). `executeJellyfinUserState` converts that boolean to position **1**, then returns when it differs from current state (`src/lib/sync/jellyfin.server.ts:858–866`). The real comparator rejects local position zero versus this desired position one.

The approved Reset playback position action reaches this path (`src/lib/ui/components/MediaActions.svelte:285`), as do numeric progress writes through internal tracking (`src/lib/server/api/tracking.server.ts:20`) and public tracking (`src/lib/server/public-api/mutations.server.ts:51`). Ordinary numeric positions over two seconds are also dropped; positions around one can send the wrong value because the comparator tolerates one-second differences. With automatic reconciliation disabled, reset remains local. With it enabled, a later full sync may deliver the incorrect zero retained for a nonzero API edit. This does **not** describe normal player reports, which use the separate `enqueuePlaybackActionsInTransaction` path.

Pass the committed numeric position/duration for progress, including explicit zero for bulk resets, and derive the job payload and intent from one value. Add a disposable regression covering UI single reset, group reset and a nonzero public API edit through queued delivery, with automatic reconciliation both off and on. Existing adapter `setProgress` tests prove only the low-level request, not this orchestration.

### JELLYFIN-02 — P2: Music copies overwrite one canonical title's observation in item order

**Strong static evidence; pure decision verified.** `persistMusic` intentionally merges matching recording/release-group identifiers (`src/lib/music/persistence.server.ts:27–34`). However, full music sync calls `importMusic` for each provider item (`src/lib/sync/jellyfin.server.ts:720–723`), and each call immediately reconciles favourites, history and progress under that shared work ID (`:455–469`). It does not perform the canonical aggregation used for screen copies.

With two accessible copies of one recording, copy A can report favourite=true/count=3/resume>0 and copy B false/0/0. After A is imported, B is classified as a subsequent remote edit; the real `decideSync` returns `remote` for the 3→0 history sequence. The callback sets `music_progress.play_count=0` (`:466`), while historical listen rows remain. Favourite/resume similarly depend on sort order. Album copies with the same release group have the same favourite issue. Incremental music imports also reconcile only returned changed items, without combining already accessible copies.

Persist account-scoped music observations alongside access, and reconcile one bounded canonical-work observation with a documented merge rule, reusing the screen pattern. Preserve retry-safe listen IDs and explicit genuine remote removals. A disposable fixture should use two external IDs with one recording ID across different pages, assert stable favourite/count/resume under reversed item order and repeated imports, then test a delta changing only one copy.

### JELLYFIN-03 — P2: Companion reset can accept an inventory started before the lost events

**Strong static evidence.** Reset queues `jellyfin.sync` through `request` (`src/lib/providers/jellyfin/updates.server.ts:69–73`), but that helper returns an existing pending/running/failed job without requiring a fresh pass (`:55–60`). Only shared-library jobs receive a follow-up-full flag. A personal user scan's committed cursor, scan ID and start time remain resumable (`src/lib/sync/jellyfin.server.ts:203–208`). Once the pre-reset job succeeds, its ID ceases to be outstanding and the feed can become healthy (`src/lib/providers/jellyfin/updates.server.ts:110–118`). Healthy mode extends user polling to the full interval (`src/lib/providers/task-timing.ts:71`).

For example: import page one, yield, change a page-one item's watched/favourite state, restart/overflow the plugin so that hint is lost, acknowledge reset, then resume the existing user job at page two. Page one's old observation is never fetched again, yet this job satisfies the recovery baseline. The stale state can persist until the next full interval (24 hours by default). A resumed phase already in music/reading/finalization is an even clearer case.

Retain a reset fence and require a complete user traversal begun after it. Use the existing durable follow-up mechanism or a serialized checkpoint restart; do not clear a running worker's cursor without coordinating its publication. Preserve bootstrap cursors independently. Add a disposable test that resets during a yielded full user import and verifies the earlier page is re-read before companion status becomes healthy.

### JELLYFIN-04 — P2: Companion session DTO drops the key used to exclude duplicate shared streams

**Confirmed contract mismatch; duplicate database result statically traced.** The companion's session DTO includes `Id`, `UserId`, `Client`, `DeviceName` and playback fields but omits `DeviceId` (`../coast-plugin/Coast/Api/ChangesController.cs:35–52`). Coast permits that omission and presents `deviceId:null` (`src/lib/providers/jellyfin/streams.ts:16`). Shared provider observations are excluded solely by comparing `snapshot->>'deviceId'` with a shared playback session's provider device ID (`src/lib/sharing/streams.server.ts:29`). SQL null cannot match it.

When a shared Coast playback is visible in a healthy companion snapshot, its observed server row survives the exclusion and is returned in addition to the native shared stream, inflating cards/counts (`src/lib/application/streams.server.ts:42–45,54–66`). Native `/Sessions` observations can carry the key, so this is specifically a producer/consumer parity gap. A pure presentation reproduction confirms the DTO produces null.

Include the existing device identity in the companion's sanitized session contract and assert producer parity, retaining the existing whitelist for tokens, paths and network addresses. Add a fixture that runs the real companion-shaped JSON through `applyCompanionPage` for a shared playback and verifies exactly one card/count and no duplicate history. No companion files were edited.

### JELLYFIN-05 — P2: Music and reading pagination can publish false absence after a changed traversal

**Confirmed adapter acceptance; strong static database consequence.** Screen traversal rejects changed totals (`src/lib/sync/jellyfin.server.ts:552–555`) and repeated prior items. Music and reading loops store offsets but perform neither cross-page check (`:718–729`, `:742–749`). Their adapters only validate individual page shape (`src/lib/providers/jellyfin/music.server.ts:151–159`, `src/lib/providers/jellyfin/reading.server.ts:21–23`). Full user finalization then marks older unobserved availability unavailable across the connection (`src/lib/sync/jellyfin.server.ts:788–798`).

A pure injected-transport reproduction returned tracks 1–100 of 201, deleted track 1 before offset 100, then returned tracks 102–201 of 200. Both pages passed; the second reported completion, although track 101 remained present and was never seen. A previously granted track 101 is therefore eligible for false withdrawal. Reading's 60-item offset pages, including per-item resume after a yield, have the same shift problem. Renames/reordering can also repeat/skip rows. A recent positive delta is protected by the final watermark, but a skipped item with old evidence is not.

Persist per-stage expected totals and seen-item evidence and apply the existing screen consistency/restart behavior before publishing negative coverage. Preserve bounded pages and per-item reading checkpoints. Disposable tests should delete an earlier item, change a total, and repeat an item across a music/reading resume; each must retain prior positives and leave full coverage incomplete until a clean restart succeeds. Existing malformed-single-page and static-catalogue checkpoint tests do not cover this.

## Uncertainties and ordered recommendations

Database suites were read, not executed; no live Jellyfin/plugin version or stream decoding was certified. Provider policy semantics beyond the code's explicit version allowlist were not independently revalidated against upstream. Queue infrastructure, general reconciliation preferences, browser reader lifecycle, shared playback admission and UI design are owned by other audit sections. The inventory lists partial cross-boundary reads as substantive reads, not as complete reviews of those domains. No performance claim is based on elapsed unit-test time.

1. Correct numeric manual progress intent/payload and add the delivery regression.
2. Make music reconciliation canonical-work scoped before extending that import path.
3. Require post-reset recovery baselines and align companion stream identity fields.
4. Carry the screen traversal consistency fence into music/reading before negative publication.
5. Keep the existing ownership, authorization, request lanes and bounded checkpoint structure; these fixes do not require a new framework, production dependency, redesign or compatibility shim.
