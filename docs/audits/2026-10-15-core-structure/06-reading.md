# Reading audit — 2026-10-15

## Scope and method

Reviewed the current working tree's Books/Comics metadata, canonical identities, personal progress/history, reader sessions, lazy PDF/EPUB/CBZ engines, reading-party integration and provider-detail routes. This was a read-only engineering audit; only these report artifacts were written. No database, live provider, credentials, server, browser, dependency installation, build or type-generation command was used.

Substantively read all files under `src/lib/reading/` (including its reader engines), `src/lib/core/reading/service.server.ts`, `src/lib/catalogue/reading{,-files}.server.ts`, `src/lib/application/reading.server.ts`, `src/lib/providers/reading.server.ts`, both metadata adapters, `src/lib/providers/jellyfin/reading.server.ts`, `src/lib/server/api/reading.server.ts`, provider-detail route pairs, canonical media route pair, `src/lib/playback/synced/client.svelte.ts`, relevant room-service branches, Reading database tables/history migration, retention, shared Search, modal/actions/Dialog integration and the directly relevant tests. Read the organization, architecture, performance and Reading guides. The JSON inventory distinguishes shared files inspected in relevant portions from complete feature files.

Ran five existing non-DB suites: **26 passed, zero failed, 174 assertions**. Also ran two isolated `bun -e` reproductions importing the actual reading client module, with `$state` as an identity function and mocked API/playback modules. They exercise asynchronous orchestration without Svelte/browser rendering or real application effects. Database concurrency findings below are static interleavings with precise disposable-fixture reproductions; they were not executed against a database.

## Coverage and healthy patterns

- Canonical ingestion is separate from explicit Add orchestration and private writes. Metadata fetches finish before identity/user transaction locks. Exact provider IDs, deterministic identity locking, conflict detection and stable UUIDs avoid title-based deduplication. Provider cards hydrate registered identities in a bounded batch rather than importing each result.
- Local/private progress, shared metadata and account-scoped file access are separate. Session ownership, enabled categories, account generations, exact Jellyfin item revalidation and edition checks protect file serving. Provider credentials and file paths stay outside browser session DTOs. Range forwarding is authenticated and constrained.
- Progress writes use the existing per-user advisory lock, no-op detection and transactional webhooks. Completion is explicit, EPUB CFIs do not overwrite physical-edition page counts, and a database trigger journals state transitions without turning every page turn into Activity.
- Provider schema/URL normalization, bounded caches and common single-flight/priority transport remain in place. Open Library has one indexed author/edition lookup; Comic Vine series enrichment is batched and bounded. Common transport retains 1.1-second/18.1-second spacing, cooldown and priority behavior.
- Selected-format imports stay lazy. PDF owns a worker and one canvas; CBZ owns one image/URL; EPUB verifies actual extraction budgets and rebuilds the archive before EPUB.js sees it. Chapter sanitization now creates/prepends a policy-bearing head and rejects unsupported roots. No surviving declared-only EPUB or missing-head CSP finding was identified.
- Shared routes, modal, Shelf/card presentation and action controls are reused. No design change is recommended. `readerLoad` lives in the dispatcher and is imported by PDF/EPUB, but this inspection found no eager renderer import or concrete runtime failure attributable to that placement; it is not independently reported as a defect.

## Prioritized findings

### READING-01 — P2 — A failed final bookmark is silently discarded while the session closes

**Confirmed in an isolated client reproduction.** `recordReading` catches every location-write error and resolves successfully (`src/lib/reading/client.svelte.ts:63`). `closeReading` starts that drain, immediately clears `reader.session/location/file`, then awaits the apparently successful promise and closes the server session (lines 53–55). By the time the write rejects, its error guard no longer matches the cleared session, so even the error is suppressed.

Trigger: closing during a transient network/API failure affecting the last location write. Reproduction populated an active PDF session at page 50/100, mocked only `/location` to reject, then awaited `closeReading()`. Result: `error:""`, `session:null`, `visible:false`; requests still included both `/location` and `/close`. The unsaved latest position has no retained retry path. This contradicts the documented final-position save guarantee and can reopen at an older bookmark.

Minimal correction: make the final drain communicate failure, retain the latest unsaved session/location until the save succeeds or a visible retry decision exists, and do not silently close the server session after a failed drain. Preserve the existing one-writer/coalescing behavior.

Verification: reject the final location request, assert that close does not report an unqualified successful save or drop the pending position, then restore the API and retry; the exact final page must persist once, without replaying older pending pages.

### READING-02 — P2 — Closing an opening reader leaves loading stuck and permits a stale party item command

**Confirmed in an isolated client reproduction.** The generation checks stop at installation of `reader.session` (`src/lib/reading/client.svelte.ts:35–39`). The subsequent playback stop, dynamic import and party `item` command have no epoch/session check (lines 40–42). `closeReading()` advances the generation and clears the session but never clears `reader.loading` (lines 50–55); the old open's `finally` then refuses to clear it because the generation changed (line 43).

Trigger: close while session preparation or the asynchronous playback-stop step is outstanding. Reproduction paused mocked `stopPlayback` after installation, closed the reader, then released the stop. Actual module output was `visible:false`, `session:null`, **`loading:true`**, followed by an `item` command carrying the already closed session ID. With an active room this can produce a failed or stale item transition; `pollSynced` also treats `reader.loading` as buffering (`src/lib/playback/synced/client.svelte.ts:104`). `attachReading` likewise does not advance the opening generation, so a still-pending explicit open can later replace an attached party reader.

Minimal correction: keep the existing generation mechanism, check it and the installed session after awaited transitions before publishing, explicitly settle cancelled loading without clearing a newer open's loading, and have attachment invalidate older pending opens. Cancellation of the local hash worker can use the same operation signal when this lifecycle is repaired.

Verification: defer preparation and playback stop separately; close or attach a different session before releasing each; assert no stale room command, no replaced attached session, no leaked prepared session and `loading === false` after cancellation. The repro used module mocks only and does not claim browser acceptance.

### READING-03 — P2 — Concurrent session preparation can resurrect bookmarks after Reread resets them

**Strong static evidence; database interleaving unexecuted.** Reread obtains the per-user transaction lock (`src/lib/core/reading/service.server.ts:39`) and clears/closes all work sessions (line 62). `prepareReading` separately selects a previous bookmark and inserts a new session using that copied value, outside a transaction and outside that lock (`src/lib/reading/sessions.server.ts:54–55`).

Trigger: another tab opens the completed edition while the first starts Reread. Valid ordering: prepare reads the old page/CFI; Reread clears old sessions and commits page zero; prepare inserts its copied old bookmark afterward. That new session escaped the reset and remains valid. Its first numbered-page render writes the old page back into the newly restarted progress; EPUB resumes the old CFI even though its page counters remain separate.

Minimal correction: after provider/network work finishes, perform previous-bookmark selection and new-session insertion in one transaction holding the same existing per-user advisory lock as Reread. Retain current account/source validation and keep provider requests outside that transaction.

Verification: disposable database test with barriers after prepare's bookmark selection and before insert; commit `updateReading({restart:true,state:'reading',page:0})` between them. The prepare operation must serialize before the reset (its new session gets reset/closed) or after it (new location is null); no usable post-reset session may retain the old location.

### READING-04 — P2 — A reading-party item switch can revoke the controller between closing and attaching its source

**Strong static evidence; database/browser interleaving unexecuted.** Opening another reading file closes the previous server session before publishing the replacement party item (`src/lib/reading/client.svelte.ts:37–42`). Any intervening room-state call marks a participant with that now-closed reading session `joined=false` (`src/lib/playback/synced/service.server.ts:114–116`). The reading `item` branch installs the replacement session but does not restore `joined` (line 214).

Trigger: a host switches from reading A to B while a guest heartbeat or room read lands after A closes and before the `item` command. Hosts can still issue that command, so B becomes the room item while the host remains unjoined; the next client heartbeat drops its room with “You are no longer participating” (`src/lib/playback/synced/client.svelte.ts:107–108`). For a delegated controller, the intermediate revocation can instead make the item command fail permission checks. This is separate from a deliberate reader close: it interrupts the normal authorized item-replacement flow.

Minimal correction: hand the participant over to the prepared replacement before retiring its previous source, or explicitly complete an authorized reattachment under the existing room transaction. Do not weaken source-expiry checks or broadly reinstate kicked/left participants.

Verification: disposable room fixture with host and guest; prepare B, close A, call guest `roomState`, then publish host `item` B using the fresh revision. A successful transition must retain the initiating participant as joined with B, and its subsequent heartbeat must remain in the room. Repeat with an authorized non-host controller and with a participant explicitly removed during the switch.

## Uncertainties and exclusions

No live-file decoding, mobile gesture/keyboard behavior, deployed Jellyfin Book permissions/downloads, real Comic Vine quotas, browser heap/lifecycle measurements or database isolation behavior was executed. Existing database test bodies were inspected but their passing status is not inferred from the pure suites. Public API authorization/idempotency, general social/privacy foundations, comprehensive shared catalogue queries and Jellyfin traversal are separate reviewers' areas; only direct Reading intersections were traced here.

Server-scoped Jellyfin version hashes deliberately do not equate local byte hashes or copies on different servers; the limitation is documented and is not treated as an identity defect. CBZ's installed zip.js codec enforces declared output size during extraction, so a simple declared-size zip-bomb claim was not retained. Long/hung CBZ native image decoding and cancelling the hash worker need browser evidence before making stronger resource-leak claims.

The Jellyfin Reading import boundary was read to trace file links. Two follow-up observations were sent to the parent reviewer for ownership/deduplication: its Open Library path depends on Books being enabled even when Comics alone is enabled, and its preexisting metadata lookup uses primary `reading_works` identity rather than registered aliases. They are not duplicated as findings here.

## Minimal ordered recommendations

1. Preserve and report failed final bookmark drains (READING-01).
2. Complete cancellation/attachment generation fencing and loading cleanup in the existing client (READING-02).
3. Serialize session bookmark-copy/insert with Reread using the established user lock (READING-03).
4. Make party source replacement preserve authorized participation through the transition (READING-04).

Add focused rejection/barrier tests for these behaviors; retain existing UI, provider pacing, exact identities, privacy boundaries and lazy resource limits. No new framework, compatibility layer or dependency is needed.
