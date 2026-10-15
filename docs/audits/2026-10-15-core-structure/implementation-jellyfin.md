# Jellyfin reconciliation and recovery implementation

Implemented JELLYFIN-02, JELLYFIN-03 and JELLYFIN-05. Root separately owns JELLYFIN-01 numeric export, JELLYFIN-04 companion DeviceId, and the queue finish integration. Preserved the selected-release/GUID music changes and the reading category/alias fixes.

- **JELLYFIN-02:** Private `availability.source` observations retain generation-scoped music favourite/count/resume data. Complete scans reconcile after all music pages/filters, in bounded 100-work pages with a durable cursor. A canonical work uses favourite OR, maximum count and furthest resume across accessible copies. Delta jobs reconcile the changed canonical works against all their currently accessible observations, including when one copy is removed. Imported listen identities use the canonical work and existing account identity; retries remain idempotent. Shared metadata remains free of personal state.
- **JELLYFIN-03:** Companion resets and permission changes publish a connection-scoped reset UUID. User progress retains that UUID and an older cursor restarts when it differs. In-progress user scans yield when the reset changes; music/reading availability publishers compare the expected UUID under their existing connection lock. Companion recovery remains incomplete until matching current-generation progress completes. Root's queue finish extension queues a follow-up user traversal if reset lands between final publication and worker success, and skips it if the task has already completed the matching reset. Bootstrap retains its separate cursor.
- **JELLYFIN-05:** Music/reading stages retain expected totals across yields and reject changed totals or a repeated earlier mapped item before publication. Invalid traversal evidence clears the completed checkpoint marker and retains previous positive availability; a clean traversal must finish before negative coverage returns. Reading still commits each processed/skipped item and resumes without retaining an unbounded catalogue in the job payload. These consistency checks match the existing screen approach; the screen restart paths now also clear the prior completion marker.

No new tables, dependencies, live calls, credentials, services, UI redesign, commits or publishing operations were introduced. The new music progress phase reuses the existing listening-history wording. Queue infrastructure changes remain with root.

Verification performed here:

- Existing focused pure suites: `bun test tests/jellyfin-queries.test.ts tests/jellyfin-companion.test.ts tests/jellyfin-music.test.ts tests/active-streams.test.ts` — 26 passed, 0 failed.
- DB-disabled import checks: five existing Jellyfin/reading DB files — 30 skipped, 0 failed. New recovery plus companion files — 13 skipped, 0 failed. These checks validate imports/transpilation only.
- `git diff --check` on owned tracked edits — passed.

Added `tests/jellyfin-recovery-db.test.ts`: canonical copies across pages/reversed order/delta and genuine clears; music changed totals; reading changed totals/repeated earlier files; reset of a yielded scan; stale music/reading transactional publication; queue final-return follow-up/no redundant follow-up. The companion fixture's simulated success now publishes the completion marker that real user sync stores.

Root owns the disposable PostgreSQL runs, typecheck/build and integrated gates. At this handoff their results are pending; no database-runtime success is claimed here. A changing same-cardinality upstream catalogue cannot be proven immutable by offset pagination alone; the retained checks reject observable count/repetition instability and preserve the established screen strategy, rather than claiming snapshot isolation from Jellyfin.

## Numeric export producer regression

Added `tests/jellyfin-progress-export-db.test.ts` for root's JELLYFIN-01 correction. It follows a manual 300/1200 progress write through the committed tracking state, retained reconciliation intent, generation-bound outbox payload and `executeJellyfinUserState`, asserting the synthetic adapter receives exactly 3,000,000,000 ticks. It then performs the UI-style zero reset without resupplying duration and asserts a numeric zero intent/payload and exactly zero ticks. Both automatic import and reconciliation are disabled; explicit mapped edits must still deliver, and no playback session/scrobble is created.

A second regression resets two collection movies with different committed durations and verifies both queued zero payloads retain their own duration and deliver zero ticks. Bulk tracking is intentionally screen-only: the service validates its parent against `media` and accepts show/season/collection, while music albums use their dedicated music workflow. No audio bulk path was added or changed.

The new file imports/transpiles with DB disabled (2 skipped, 0 failed). Root owns the disposable runtime execution. This addition changes tests/report only, with no further application edits.
