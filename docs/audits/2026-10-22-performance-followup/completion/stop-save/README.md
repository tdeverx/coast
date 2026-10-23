# PR-02: approved Stop/save barrier

The user selected **wait for the previous save before starting the next item** on 22 October. This supersedes the pending choice in the earlier source review. No server mutation contract, dependency, table migration or persistent background queue was added.

## Current behavior

- Stop pauses and clears the visible player immediately. Its final position, duration, listening accounting, session and personal/share API authority are captured before media teardown.
- One component-owned final save stays in the existing ordered report queue. The existing feedback surface shows a neutral, non-dismissible **Saving playback progress…** notice while acknowledgement is pending. There is no polling loop, timer-driven discard or speculative save deadline.
- Successor playback preparation waits at a separate controller barrier, including when no visible session remains. A failed save keeps the barrier closed and exposes **Retry**. Retry sends the frozen final snapshot, is single-flight, and clears its owned notice only on acknowledgement or terminal policy withdrawal. It does not repeat party cleanup.
- Music checks the barrier before looking up a new work/saved queue. Existing preparation revisions fence late queue lookups and async queue entry so an older Play click cannot restart playback after Stop. An unsaved Stop is a distinct error, so music does not treat it as an unavailable track and skip through the queue.
- Pending-save ownership survives ordinary SPA navigation for the same account. Account changes and component destruction retire its UI ownership; late results cannot restore an old notice. Ended acknowledgements recheck session ownership before advancing or entering postplay.
- Party leave uses `keepPlaying=true` because local media is already detached; it avoids recursive Stop. Cleanup runs once, with the captured room checked before invocation. Host Stop and follower leave retain their existing authority handling.

A new item may show preparation/loading while it waits for the prior acknowledgement. An indefinitely pending save keeps that next preparation waiting, as selected. Failure is not silently discarded. If a later unrelated action notice covers the owned Retry notice, dismissing that notice reveals the existing save failure; the shared feedback-stack design is preserved.

This barrier lives in the current app document. It does not claim crash/reload/offline persistence. Shared/party hardware and policy-withdrawal cases retain the wider audit's open acceptance; no physical device was connected.

## Actual-data acceptance

A fresh marked copy was restored from the same read-only retained PostgreSQL archive and upgraded independently to PostgreSQL 17.11, with refreshed statistics. Runtime: shipping Bun revision `6bb5dc1956505dd1113455f58d4757c924f3ad54`, 4 CPUs / 2 GiB. Workers remained paused. The audit transport allowed only approved genuine reads plus the exact Jellyfin **PlaybackInfo metadata POST** required to prepare real media. It did not allow remote playback tracking/export mutations. Native progress commands wrote only the disposable Coast database.

The [accepted browser replay](browser-stop-accepted.json) uses actual existing music tracks and genuine source metadata/stream bytes. It holds one real Stop request **before** server delivery, navigates Discover/Back, requests another track, then releases the original request unchanged. The successor preparation occurs only after the Stop 200 response. A later authored network abort exposes failure; another Play is blocked before queue lookup; explicit Retry resends the exact same final payload. There are exactly three playback preparations, four Stop attempts (one failed plus retry), and no restart after final Stop. No provider response or media file was fabricated.

The [independent native verification](stop-native.json) checks the three most recent sessions at that exact data epoch: all are stopped, all final positions equal their frozen payloads, the last track's saved music position matches, and no short listen was incorrectly recorded. No export job was running. This is stronger than treating an HTTP 200 alone as save proof. The narrow-layout probe is a separate controlled run; its session is not compared against the final replay’s latest-session native query.

The [390×844 probe](browser-stop-mobile.json) verifies that the visible player closes while the pending notice remains readable and non-dismissible, without horizontal overflow or a framework overlay. The engine is cached Chromium headless shell 1243. Browser plugin was unavailable, so Playwright CLI was used. A browser autoplay flag permits the audit's async audio start; this is not physical-device autoplay/accessibility acceptance. Visual inspection of the first narrow screenshot exposed feedback overlapping the bottom navigation despite the earlier DOM checks. Global feedback now reserves space above the existing mobile navigation when no player is active; its appearance and the existing active-player offsets are unchanged. The corrected probe requires the toast to sit above navigation with an explicit gap. The new video Stop handler is exercised by compiled-owner controls; a new full real-video Stop/device replay is not claimed by the audio test.

## Regression and evidence requirements

- Run `tests/playback-stop.test.ts`, `tests/player-stop-lifecycle.test.ts`, `tests/playback-reports.test.ts`, `tests/media-lifecycle-client.test.ts` and `tests/ui-feedback.test.ts`. These are supplementary ownership/ordering controls, not actual media or database benchmarks.
- Run `scripts/performance-stop-mobile-browser.js` for the narrow pending-feedback rectangle/screenshot check. Its screenshot fast-forwards finite CSS animations so a fade-in frame is not mistaken for unreadable settled text.
- Run `scripts/performance-stop-browser.js` only on an owned marked-copy app at loopback 5175, with an actual connected music library and workers/exports paused. It holds actual request delivery and introduces one explicit network failure. Keep rejected attempts and safe payload snapshots; never log credentials, session URLs or private catalogue identities.
- Repeat native final-state equality at the same data epoch. The frozen native probe transcript shows the independent query and exact mark checks. Do not compare a later controlled run's latest sessions to an earlier run's payloads.
- Test ordinary route changes while saving: derive the account identity before the cleanup effect so replacement route data for the same account cannot retire the barrier.
- Test a late music/saved-queue read after Stop. Every new queue/automatic continuation must preserve the existing cancellation revision and the save barrier, including errors that would otherwise cause automatic track skipping.
- Keep the original start-acknowledgement order, report coalescing boundaries, played-time accounting and captured share authority. A failed refresh cannot become evidence that an acknowledged save failed.
- Extend actual video, shared/party, permission/generation withdrawal, account-switch and physical-device cases before claiming those environments accepted. Preserve the approved visual design and native server policy fences.

## Failed attempts retained

The first browser result was labelled passed before screenshot completion but then recorded a fourth preparation. It is preserved as an **unaccepted observation**, not promoted as a pass. The stricter replay failed on that extra request. Initiator tracing identified an ordinary music Play click whose queue lookup settled after Stop; it was not proven to be automatic advancement. The existing preparation-revision fence now covers those lookups, and the accepted replay checks counters and closed state after its final screenshot/settling observation.

Two audit harness issues were corrected separately: the copied shell bootstrap emitted literal `\\x27` in its private PostgreSQL configuration, and its final legacy census referenced a nonexistent `reading_sources` table after database/session creation had succeeded. Neither was a product failure; the isolated configuration was repaired and the already-created exact marked database/session was used. Original archive, live and development databases remained untouched.

Project gates, owner hashes and cleanup are recorded with this implementation epoch. Earlier whole-app and query measurements remain at their earlier source/data epochs; they are not silently relabelled as Stop/save measurements.

Final gates: **1,003 passed / 729 environment-dependent skips / zero failures**, 50 focused checks, 15 controls on the shipping Bun revision, Svelte check zero errors/warnings, successful build and inventory/style checks. [Verification](verification.json) binds the exact source/log hashes and [database](cleanup.json)/[runtime](runtime-cleanup.json) cleanup. The two unrelated user-edited files retain their original hashes.
