# Playback, reading and party lifecycle implementation

Implemented six canonical findings while preserving the existing player/reader interface. The only reader UI addition is a Retry save action inside the existing failure notice. No schema or dependencies were added.

## LIFECYCLE-01

Playback and reading preparation use revisions and abort signals, recheck after asynchronous transitions, retain current-operation loading state, and retire late returned sessions. Playback captures its API authority before share teardown. Reading attachment cancels older opens and local file hashing terminates on abort. Reading session admission also checks request cancellation.

Validation: Compiled-current-module tests cover stop/close before delayed response, reader stop transition cancellation, attachment supersession, captured share cleanup, replacement loading and hash termination. Playback server cancellation beyond a returned ID is coordinated with the root-owned playback server change.

Files: `src/lib/playback/client.svelte.ts`, `src/lib/ui/components/PersistentPlayer.svelte`, `src/lib/ui/client.ts`, `src/lib/reading/client.svelte.ts`, `src/lib/reading/reader/file-identity.ts`, `src/lib/reading/sessions.server.ts`, `src/lib/server/api/reading.server.ts`.

## PLAYBACK-03

Explicit audio retry bypasses same-item resume and requests a fresh prepared session without forcing fromStart; normal same-item playback still resumes. The retry-only flag is removed before the server request.

Validation: Client fixture asserts normal resume sends no prepare request, recovery sends exactly one new prepare and replacement stop does not cancel its own request.

Files: `src/lib/playback/client.svelte.ts`, `src/lib/ui/components/PersistentPlayer.svelte`.

## READING-01

Bookmark writes retain the latest failed position and return drain success. Close waits for a successful drain before clearing or retiring the session. Failure leaves the reader and file available with its existing notice and a Retry save action. New page turns replace older failed pending positions.

Validation: Client regressions reject the final write and assert session/position/unsaved notice remain, no close request is sent, retry saves the newest page, and failed older writes cannot replace newer queued pages.

Files: `src/lib/reading/client.svelte.ts`, `src/lib/reading/Reader.svelte`.

## READING-03

After provider work, bookmark selection and session insertion run under the same user advisory transaction lock used by Reread. The transaction rechecks user/category and locks/rechecks connected source generation and enabled instance before copying a bookmark.

Validation: Added guarded database race regression: concurrent preparation and Reread must leave preparation either closed by reset or carrying a null bookmark. DB execution remains with the coordinator.

Files: `src/lib/reading/sessions.server.ts`.

## READING-04

Reading replacement publishes the prepared new source before closing the old source. Server item handover revalidates the replacement inside the room transaction and can restore only an existing recent host membership whose prior source was deliberately closed but remains unexpired and authorized. Removed actors, expired old sources, expired rooms and invalid replacement sources are rejected.

Validation: Pure ordering test asserts item publication precedes old-session retirement. Added guarded DB tests for intervening roomState, live host retention, expired/missing membership rejection, delegated controller handover and kicked-controller rejection.

Files: `src/lib/reading/client.svelte.ts`, `src/lib/playback/synced/service.server.ts`.

## SOCIAL-01

Failed party source suppression keys work, medium, edition, duration and reading format. A changed descriptor clears suppression and permits one new preparation; unchanged failed descriptors remain suppressed. Existing Retry UI remains unchanged.

Validation: Compiled party-client fixtures cover edition recovery and reading format/duration changes while asserting no repeated preparation for unchanged failures.

Files: `src/lib/playback/synced/client.svelte.ts`.

## Verification and limits

- `PATH="$PWD/.tools/bun-darwin-aarch64:$PATH" bun test tests/ui-client.test.ts tests/media-lifecycle-client.test.ts tests/synced-client.test.ts tests/reading-hash.test.ts tests/reading-reader.test.ts tests/synced-playback.test.ts tests/playback-failures.test.ts` — 38 passed, 0 failed; 142 assertions across 7 files.
- `bun test tests/reading-sessions-db.test.ts (COAST_DB_TEST unset)` — 13 guarded database cases skipped; import/parse succeeded. No database calls were made.
- `Svelte compiler compile(...,{generate:false}) for Reader.svelte and PersistentPlayer.svelte` — Both components compiled successfully.

Focused test additions live in `tests/media-lifecycle-client.test.ts`, `tests/synced-client.test.ts`, `tests/ui-client.test.ts`, `tests/reading-hash.test.ts` and `tests/reading-sessions-db.test.ts`.

No check, build, full database suite, live/developer database, provider calls or actual playback/reader browser session was run by this agent.

Pure client fixtures compile current source with mocked boundaries; they verify ordering/cancellation/retry behavior, not actual media decoding or rendered visual acceptance.

Three newly added DB regressions require coordinator execution; source-account replacement and host reattachment database behavior remain unverified dynamically until then.

No schema, dependencies, production UI redesign, commit or push was introduced. Root owns personal playback server/account-generation work; its changes are excluded from this agent implementation.


## Follow-up: personal generation and final admission

Reviewed the root-owned PLAYBACK-01 generation guards and closed one remaining LIFECYCLE-01 preparation gap: subtitle capabilities, presentation/details and source-option hydration previously awaited after the prepared row committed. They now finish before final locked admission, using a preallocated UUID; no response-enrichment awaits remain after insertion. Cancellation checks also run before work, after provider awaits, within admission and immediately after commit. Post-commit cancellation retires the prepared row.

Party playback admission/state now checks the same generation. Valid raw SQL playback fixtures bind the current connection generation. `sync/jellyfin.server.ts` was inspected and its root guard retained without edits.

`tests/playback-generation-db.test.ts` adds six guarded cases with synthetic provider mocks: pre-abort, late presentation abort preserving active playback, replacement during provider preparation, replacement during final presentation, cancellation observed immediately after commit, and stale direct/HLS video/audio sessions refusing progress/relay/party/scrobble against the replacement account while fresh sessions succeed. The reading Reread case now uses a deterministic transaction-entry barrier.

Follow-up local command: `bun test tests/ui-client.test.ts tests/media-lifecycle-client.test.ts tests/synced-client.test.ts tests/provider-contracts.test.ts tests/playback-generation-db.test.ts tests/reading-sessions-db.test.ts` — **61 pass, 19 guarded DB skips, 0 fail, 227 assertions**. The fetch mock preserves Bun's `preconnect` member for global type checking. Coordinator database/global checks remain required; this agent used no DB flag, provider or browser runtime.


## Follow-up: actual maintenance scheduler regression

`tests/maintenance-lifecycle.test.ts` verifies the root PLAYBACK-04 fix by importing the complete real maintenance module inside an isolated Bun child. Only external cleanup, database/config, retention and logging boundaries are mocked; the actual `scheduleProviderMaintenance`, `maintenanceTick`, `runMaintenance` and timer lifecycle run. A stalled cleanup does not delay ordinary scheduling, repeated timer callbacks coalesce both pending passes, later ordinary passes continue while cleanup remains stalled, completion/failure releases cleanup for retry, developer-mode cleanup still runs, and stop clears the timer. No further scheduler source change was needed.

Focused command: `bun test tests/maintenance-lifecycle.test.ts` — **1 pass, 0 fail**. Child results: cleanup=5, schedules=6, retention=1, cleared=true. No mocks escape the subprocess, and no database or provider was called.

The coordinator's first generation DB run exposed assertion-shape/message assumptions, not extra sessions: Bun array `toMatchObject` rejected extra selected columns, and source-switch triggers may expire a session before the generation guard. Assertions now project exact fields and accept either explicit expiry/account-change denial while retaining no-provider-effect assertions. SQL result arrays are explicitly typed for the global check.


## Final fixture authority and shared abort coverage

Later positive cases in `synced-onboarding-db.test.ts` reused a source row after an earlier test deliberately replaced its account. Their synthetic re-preparation resets now bind the current connection generation. The old-session revocation case remains unchanged and production guards remain strict.

`sharing-db.test.ts` now includes one API-level cancellation regression against its existing synthetic provider: hold PlaybackInfo, abort the incoming POST, then require a failed response, ended reservation, cleared preparation token/lease, no published or active session and no owner history. A subsequent retry must succeed. Import-only local validation reported 36 guarded skips and no failures; disposable execution remains with the coordinator.
