# Social, notifications and parties audit

Reviewed 15 October 2026 against the current working tree, including current untracked feature files. This is a read-only engineering audit; only these report files were written.

## Scope and method

Traced friendships, social visibility and derived badges/feed, live observations/check-ins, taste comparison/cache, notification delivery/read/dismiss, party creation/invitation/join/commands/heartbeat, panel URL state, and their rendered UI/direct callers. Consulted the organisation, architecture, performance, social and synced-experience guides, then checked implementation and relevant schema triggers. Full substantive-read and targeted-scan inventories are in [the JSON report](08-social-parties.json); a scanned file is not claimed as fully reviewed.

Normal playback and reading engines, full profile read models and public API contracts belong to other audit sections. Their integration points were read here as necessary. No database, services, browser, real accounts or live providers were used. No build/check or application mutation was run.

## Coverage and healthy patterns

- Friendship pairs serialize requests and enforce pending/accepted actor roles. Recommendation responses act on durable records, independently of notification presentation.
- `social_visible` centralizes owner, accepted-friend, audience, disabled-account and per-category rules. Feed, reactions, status, live progress and comparison values generally reuse this policy. Reading state activity uses section `progress` in its trigger, so reading page values are protected by that section rather than only general activity visibility.
- Live observations distinguish empty/failing reads from completed history. Provider generations are rechecked before publication; provider failures clear matching observations through queue failure handling. Manual check-in completion uses a user lock and stable tracking identity; Trakt delivery keeps uncertain/success evidence.
- The notification inbox filters before pagination, has deterministic timestamp/ID cursors, counts all matching unread items, scopes read/dismiss writes to the recipient and current visibility, and uses a snapshot for read-all. Visible-read batches are bounded to 60 IDs.
- Parties require invitations and accepted host friendships, prepare participant-owned sources, check compatible leaf/edition/duration, serialize room commands, enforce revisions and independent host/playback/queue permissions, and bound rooms, participants and queues. Stale client responses use generation/revision fences. Account-change expiry triggers support playback revocation.
- Friends, Notifications and Streams have focused navigation modules. Shared resources cancel superseded responses; existing UI composition and provisional design labels are retained.
- Personal taste caches use the existing outbox, ten-user batches, bounded candidate/evidence methods and revision-checked writes. The separate friend-comparison page still has the growth problem below.

## Prioritized findings

### SOCIAL-01 · P2 · A failed party source stays unavailable after the host changes its edition

**Confidence:** confirmed. **Root cause:** `party-source-failure-cache-uses-only-work-id`.

A joined guest cannot prepare edition A of work W. The host selects edition B (or another duration/reading format) of the same W that the guest could access.

The guest adopts the new room descriptor but never prepares the replacement source, keeps sending unavailable=true and can hold Pause together. Manual Retry/rejoin is required despite a new playable descriptor.

Evidence:

- [src/lib/playback/synced/client.svelte.ts:103](../../../src/lib/playback/synced/client.svelte.ts:103) — The next heartbeat reports unavailable solely from equality with unavailableMediaId, independent of source edition/duration/format.
- [src/lib/playback/synced/client.svelte.ts:114](../../../src/lib/playback/synced/client.svelte.ts:114) — Source preparation is skipped whenever the next mediaId equals the previously failed mediaId.
- [src/lib/playback/synced/client.svelte.ts:123](../../../src/lib/playback/synced/client.svelte.ts:123) — A failed source preparation records only next.mediaId.

**Minimal correction:** Remember the failed source descriptor (work, medium, edition, duration and reading format) and suppress retries only while that descriptor is unchanged; clear the failure when it changes. Preserve bounded automatic retries for an unchanged failure.

**Verification:** Extend the existing compiled synced-client fixture: fail preparation for W/A, deliver heartbeat W/B, assert one new source preparation and attachment; subsequent unchanged failed W/A polls must remain suppressed. Repeat for reading format/duration changes.

### SOCIAL-02 · P2 · Recommendation send and response lock the same rows in opposite orders

**Confidence:** strong-static. **Root cause:** `recommendation-friendship-row-lock-order-inversion`.

A sender repeats a pending recommendation while its recipient saves or dismisses it: send holds friendship F, response holds recommendation R, then each waits for the other's row.

PostgreSQL detects a deadlock and aborts one valid user operation; the existing route/client does not transparently retry this database deadlock. Transactional rollback protects stored state but the user sees a failed send or response.

Evidence:

- [src/lib/social/service.server.ts:102](../../../src/lib/social/service.server.ts:102) — recommend locks the accepted friendship before inserting/updating the pending recommendation.
- [src/lib/social/service.server.ts:105](../../../src/lib/social/service.server.ts:105) — ON CONFLICT DO UPDATE locks an existing pending recommendation row.
- [src/lib/social/service.server.ts:114](../../../src/lib/social/service.server.ts:114) — respondRecommendation locks the recommendation first.
- [src/lib/social/service.server.ts:116](../../../src/lib/social/service.server.ts:116) — The response then requests the friendship lock held first by recommend.

**Minimal correction:** Use one lock order for both operations, preserving the friendship authorization lock. Read immutable recommendation identities as needed, then lock friendship before locking/rechecking the recommendation, or serialize both on the same narrowly scoped key.

**Verification:** In a disposable database, create a pending recommendation and use two transactions/barriers to force F-then-R against R-then-F. Verify no deadlock after the fix, one durable response, and concurrent friendship removal still prevents unauthorized delivery.

### SOCIAL-03 · P2 · The paged Taste page rebuilds and transfers both complete libraries

**Confidence:** strong-static. **Root cause:** `friend-insights-full-evidence-and-overlap-materialization`.

Two friends have large imported screen/music/game libraries, then open Taste & overlap or change a page/filter.

Database result size, feature hydration and response payload grow with both complete libraries; application overlap work additionally grows quadratically. The visible 60-card pagination does not bound this workload. No production latency threshold is claimed.

Evidence:

- [src/lib/social/insights.server.ts:8](../../../src/lib/social/insights.server.ts:8) — The candidates query unions all relationship/history/progress evidence for both users, without a sample or page bound.
- [src/lib/social/insights.server.ts:32](../../../src/lib/social/insights.server.ts:32) — Metadata feature hydration receives every candidate ID, including evidence later discarded by the meaningful filter.
- [src/lib/social/insights.server.ts:41](../../../src/lib/social/insights.server.ts:41) — Progress comparisons perform b.find for each work; onlyFriend also performs a.some per work on line 42.
- [src/routes/taste/[friendId]/+page.server.ts:17](../../../src/routes/taste/[friendId]/+page.server.ts:17) — Every page/filter load rebuilds the complete comparison.
- [src/routes/taste/[friendId]/+page.server.ts:19](../../../src/routes/taste/[friendId]/+page.server.ts:19) — Only overlap card hydration is sliced to 60; the complete comparison with every overlap ID and comparison is returned on line 20.

**Minimal correction:** Use ID maps/sets for linear overlap matching, return exact counts plus only the requested overlap IDs/progress page, and bound the taste feature evidence using an explicit documented sampling policy compatible with the existing bounded taste-profile method. Keep exact aggregate totals separate from sampled scoring and retain every visibility predicate.

**Verification:** Disposable fixtures with increasing libraries should verify identical exact overlap counts, bounded returned IDs/progress/features, stable deterministic paging, explicit sparse/sampled taste semantics, and private-section/category exclusion. Measure query rows, response bytes and CPU separately.

### SOCIAL-04 · P2 · Saving a music relationship hides its actual progress in friend comparisons

**Confidence:** strong-static. **Root cause:** `friend-insights-prefers-screen-projection-zero-over-music-progress`.

A music track has music_progress.position_seconds > 0 and no completed listen, and its owner collects/favourites/saves it, creating a tracking_state row with position_seconds=0.

Taste & overlap reports 0% instead of the concrete music position, counts the saved track as planned instead of active, or drops progress-only evidence when an empty projection already exists.

Evidence:

- [src/lib/social/insights.server.ts:17](../../../src/lib/social/insights.server.ts:17) — COALESCE prefers tracking_state.position_seconds over music_progress.position_seconds.
- [src/lib/server/db/schema.ts:499](../../../src/lib/server/db/schema.ts:499) — tracking_state.position_seconds is non-null with default zero, so an existing relationship projection never falls through to the music position.
- [src/lib/core/tracking/service.server.ts:71](../../../src/lib/core/tracking/service.server.ts:71) — Canonical tracking creates the shared relationship projection with defaults.
- [src/lib/social/insights.server.ts:31](../../../src/lib/social/insights.server.ts:31) — The same precedence controls whether otherwise progress-only evidence survives the SQL predicate.
- [src/lib/social/insights.server.ts:39](../../../src/lib/social/insights.server.ts:39) — Active/planned statistics and progress comparisons use the incorrectly selected position.

**Minimal correction:** Choose progress from the concrete medium: music_progress for music, tracking_state for screen. Reuse that same expression in both SELECT and eligibility predicates and keep the progress visibility check.

**Verification:** Disposable social fixture: accepted friends with shared progress; track with music_progress 30/120 and tracking_state favourite=true, position_seconds=0, no music_listens. Assert 25% comparison and active=1; make progress private and verify the value is withheld. Also test an empty tracking projection.


## Checks and limits

- Ran `PATH="$PWD/.tools/bun-darwin-aarch64:$PATH" bun test tests/social.test.ts tests/social-activity.test.ts tests/social-status.test.ts tests/synced-client.test.ts tests/synced-playback.test.ts tests/taste-profile.test.ts tests/ui-social-enrichment.test.ts`: **31 passed, 0 failed, 153 assertions**.
- Executed a harmless Bun stdin fixture compiling the current party client through the Svelte compiler, with in-memory API/player/storage substitutes. Starting from failed work `same-work` / `unavailable-edition`, a heartbeat supplied `available-edition` for the same work. Output was `{"calls":["synced/room/heartbeat"],"edition":"available-edition","unavailableMediaId":"same-work"}`: the descriptor changed but no source preparation occurred.
- Database fixtures for notifications, friendship/privacy, live observations and parties were inspected, not executed. SOCIAL-02 and SOCIAL-04 need the specified isolated database reproductions. SOCIAL-03 establishes unbounded cardinality and quadratic matching statically, without claiming production memory or timing measurements.
- Multi-account browser, real source/edition selection, mobile/autoplay and real-device party acceptance remain unverified. Existing fixtures do not certify those behaviors.
- The broader notification/provider outbox and normal playback transport have dedicated audit owners; this section checks their social integration only.

## Known work and cross-section overlap

Activity-feed hydration can exceed the 60-work card batch when each event brings a parent. That remains roadmap-known, including callers such as reaction notification hydration; it is **not a new SOCIAL finding**. Bound the existing hydration path when that parked task is selected, preserving feed order and visibility.

The coordinator supplied the reading-host replacement/unjoined issue and private-playlist caption issue as findings already owned by reading/domain reviewers. They are not counted again here. Generic real-account/device acceptance remains roadmap work rather than evidence that a particular code path is broken.

No additional naming/placement finding was raised solely for compact formatting or file size. Social ownership, protected server modules, the party client/server split and focused panel modules largely match the documented tree. Replacing them with a generic social framework would add unnecessary complexity.

## Minimal ordered recommendations

1. Fix the descriptor-scoped party failure cache and add the existing compiled-client regression case.
2. Give recommendation send/response one row-lock order, retaining friendship authorization and atomic tracking/notification effects.
3. Select concrete music progress in friend comparisons and cover default-zero shared relationship projections.
4. Bound the friend Taste page's data/payload and replace nested matching with maps/sets; distinguish exact overlap totals from bounded score evidence.
5. Run the focused disposable-database and multi-account browser checks when those environments are authorized. Retain the approved UI, existing queue, privacy predicates and provider generation fences.
