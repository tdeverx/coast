# Menu status and toast follow-up

17 November 2026. This local review starts at merged source `b76964d`; earlier published receipts retain their original files and acceptance boundaries.

## Reviewed changes

- Request options retain configured, permission-eligible standard/4K destinations when all items are covered. Disabled movie variants and show/season/episode choices expose Available/Requested status. Dialog initialization prefers the intended quality and supplied seasons, while explicit inspection of a covered destination remains possible. Existing command-side duplicate, availability and permission checks still gate submissions; no cross-destination writes are introduced.
- `Shelf` row titles restore the existing play-icon availability shortcut through `ui/shelves/controls.ts`. Heading/section controls and the menu checkbox share one filter state and command owner, with no additional query or alternate cache.
- Shared icon-only menu items use the same directly sized grid layers and clipping approach as rating stars. Checked, hover, focus, accessible labels and destructive deselection behavior remain. Root observed working live icons on the exercised IAB device; that does not reproduce or certify the other device's blank-row report.
- Toast avatar/media stamps link to existing profile/media destinations and reuse their existing interactive elements. The approved stamp hover scale is 1.12. Pause callbacks run untracked, preventing callback-owned state from becoming a toast-effect dependency. Close/expiry suppress presentation while preserving unread inbox records, including persistent notices.
- Authenticated action feedback is retained as own-user, plain-text inbox context. Stable notice IDs make retries idempotent and prevent a second server toast. Viewer-bound continuations cannot publish old-account feedback into a replacement account. Preview transport does not record real notifications.

## Performance and ownership

The feedback writer admits one active lane, at most **20 notices** per batch and a backlog of **200 records** by distinct notice identity, with a **15-second** abort deadline. A newer record may coexist with its old in-flight revision until that batch settles. Text is bounded to 2,000 characters. Owner replacement aborts the old lane; retry keeps notice identity, refreshes are coalesced, and overflow produces an explicit non-recursive delivery warning. This is tab-lifetime retry ownership, with no offline/reload delivery guarantee. Pending feedback is historical context, not an invented completed operation. Server validation rejects another viewer's IDs and arbitrary rich notification payloads; normal notification uniqueness, visibility and account scoping still apply. Request-status changes add no provider or database read, dependency, schema migration or global polling owner. These are source/lifecycle bounds, not latency, throughput or heap measurements.

## Evidence and limits

Root's signed-in IAB inspection reproduced the old Request submenu's “Nothing to request” state for an all-covered episode; live quick icons on that device rendered at 20 × 20 pixels. The original transient invalid-response error and stranded flyout were **not reproduced**. Source review identifies successful non-JSON responses as one possible existing client error classification, not an established cause.

Hydrated synthetic toast proof verified avatar/media navigation to static fixture destinations, focus pause/resume, 44px avatar, 58px media artwork and 16px content padding (`/tmp/coast-toast-stamps-verified.jpg`). Such fixtures are separate from live provider/account acceptance. **Firefox and the reported failing device remain untested**; no cross-browser artifact fix is certified. Live inspection submitted no request/tracking changes. No production repair/deployment or material changes belong to this follow-up.

## Validation

Before the test-housekeeping follow-up, local gates passed at `d2be547` after the row restoration and fixture corrections: **1,188 unit tests passed, 836 guarded skips, 0 failed; 37,941 assertions across 352 files** (10.96s). Type/Svelte checking reported **0 errors and 0 warnings**; the production build passed. Style checks cover **57 adopted modules**; code inventory reports **645 production modules, 0 unused and 79 roots**; UI inventory reports **65 public components, 29 compositions, 19 internal renderers and 9 delegated routes**. **Hosted CI remains pending** for the future published commit. The intermediate full-unit run reported 1,177 passed, 833 guarded skips and seven failures: six stale source pins and one ConnectionCard test-port fixture, subsequently corrected. The first native notification selection reported 14 passed and one new fixture setup failure (missing settings), followed by a corrected disposable PostgreSQL rerun with **15 passed, 0 failed and 90 assertions** (`/tmp/coast-followup-db.log`). Focused request selection passed **33 tests / 362 assertions**, focused feedback selection passed **77 tests / 454 assertions**, and the shelf selection passed **10 tests / 62 assertions**; selections overlap and are not summed as unique tests. Failed setup and guarded skips are not promoted to broader database/provider acceptance.

The new source receipt advances exact predecessor hashes without rewriting published reports. Retained natural-data, physical-device, production-size and performance-audit blockers remain separate.

## Test housekeeping follow-up

The follow-up removes three compile-only smoke tests: “all changed components compile with their complete client and server templates” (`lazy-import-lifetimes`), “changed refresh consumers compile with their complete client and server templates” (`route-refresh`), and “complete avatar templates retain client and server compilation” (`avatar-picker-lifetime`). CI already runs the complete Svelte check and production client/SSR build. The actual lazy-import, viewer/permission, refresh, avatar decoding, cancellation and teardown tests remain. Unused compile imports/source reads and the stale toast-host `ApiError` injection were removed; real error-response cases and no-JavaScript SSR/escaping tests remain. The auth fallback no longer extracts an unused error class from the browser client. No production behavior or test framework changed.

The local green results above precede this cleanup. **No local test or validation commands were run for the cleanup, as explicitly requested; the updated commit's CI is pending.** This is removal of redundant compile work and dead fixture plumbing, not a newly measured runtime performance improvement.

## Account transition review

The root layout and persistent player follow the current viewer for watched errors. Playback fallback and final-save feedback capture the viewer when the operation starts. The toast host filters presentation by viewer and clears only the departing viewer’s notices on teardown. Regression cases exercise sign-in with an existing watcher, an old operation finishing late, and host replacement with a pending Undo action. Validation for this revision runs in PR CI.

The initial review-fix CI run identified a missing dependency in the extracted playback stop test fixture. The fixture now supplies the feedback capture used by the production handler. Its playback assertions are unchanged.
