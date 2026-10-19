# Loading feedback, preferences and Coast integration

19 October 2026. This is the later source/acceptance epoch after the [initial focused audit](README.md). The user requested loading feedback, a default-on odd-face preference, reading activity/party/sharing checks, and a PR/merge after green checks. The [delivery investigation roadmap](investigation-roadmap.md) remains future research; no range/page-service/cache redesign was adopted.

## Current behavior

- The shared Reader shows download bytes and known-total percentage, then actual checked-page counts over the existing fade. Unknown totals/preparation are indeterminate; no invented whole-operation percentage is shown. `OperationProgress` remains the shared bar, with optional accessible value text for units other than items.
- At the render/preparation phase, text and bar disappear and the physical reader's app backdrop blurs. The book and higher-layer navigation stay sharp. Close/minimize/failure remove feedback; late progress cannot update a replacement reader. PDF/EPUB use the same progress contract without changing their file/party owners.
- **Settings → Appearance → Sanitize odd page counts** defaults **on**, including existing accounts without a stored choice. This preserves intentional unmatched-final-face trimming and original final-location behavior. **Off** preserves every face with unprinted binding faces and the actual outside back cover. PDF padding is unchanged. The choice is validated/persisted in existing user JSON settings, participates in preference reset and is captured on reader open; no migration is needed.
- User live presence already reads actual reading sessions; reading state transitions already populate shared Activity and owner history. Actual tests verify both. Page movement still does not add history rows.
- The admin Active streams panel previously read Jellyfin playback scans/shared playback only. Comic downloads do not create a Jellyfin playback session. Its existing snapshot/count owners now include bounded Coast reader-session projections, with existing user/category/feature/source-generation gates, two-minute heartbeat freshness, 21-row lookahead and merged cursor ordering. Closed/expired readers appear in History; stale-but-open sessions leave Now without manufacturing a durable end event. Page positions are labelled as reading locations, never playback seconds. No new polling loop, provider scan, event journal or schema was added.

## Actual-data acceptance

Normal dev at the existing LAN host on **port 5173**, a separate authenticated actual-admin browser session, Chromium desktop 1280×800/mobile viewport 390×844:

1. Verified inherited enabled preference, saved Off/On through the settings form, reloaded each and restored the original stored field afterward.
2. Opened an actual 73,339,323-byte CBR. A controlled 5 MB/s browser throttle made genuine download progress observable; neither media bytes nor provider replies were fabricated. Desktop/mobile screenshots show the loading overlay.
3. Verified the bar/text are absent at preparation and computed backdrop blur is 8px. Minimize/resume/close remove the overlay/host; actual admin progress/history remain identical.
4. Verified the same active reader in native user presence, the native admin snapshot and the rendered admin panel with **Reading** and the actual title.

Known console observations remain the artwork palette CORS rejection and its failed-resource message; no new reader exception was observed. This is a narrow-viewport/software-GPU check, not hardware mobile FPS, a memory plateau or two simultaneous live browser party clients.

The maintained `scripts/reading-integration-native.ts` passes **19 checks** on an owned disposable restore of actual data. It verifies preference validation/persistence/reset, own presence, Activity and owner journal, no page-turn history flood, anonymous admin-panel rejection, stale-heartbeat removal, actual host canonical party location, stale revisions, playback-seek rejection, independently authorized matching-edition guest join/leave, follower command rejection, host-session access isolation, unsupported public playback sharing, closed-reader History, sub-millisecond cursor pagination and source-withdrawn participation. Existing actual identities/files are used; friendship/party/state conditions are controlled only on the copy. No worker delivers clone notifications.

A naturally stale guest link initially prevented preparation. On the copy, the same existing file was verified through that guest's real Jellyfin account and exact source identity before the matching-edition checks; no filename/title inference or access bypass was used. Normal guest mappings were not rewritten by this test. The initial stale failure and harness mistakes (anonymous 401 expectation; missing controlled-friendship requester) remain private failed receipts rather than being presented as application fixes.

The raster harness supports `COAST_READING_SANITIZE_ODD_PAGES=true` to compare the default against original complete pixels/locations; its default false explicitly exercises preserve-all opt-out and independently verifies the real tail/back cover. Both modes pass a later actual-comic replay (four samples/mode): default-on complete pixels/locations match the original; opt-out preserves the printed prefix and independently verified true tail/back cover. Earlier five-file preserve-all receipts remain historical evidence for that mode, not default-on acceptance. Aggregates and later source hashes are in [loading-evidence.json](loading-evidence.json).

## Gates and maintenance

Current common gates: **862 app passes, 717 guarded skips, zero failures; 123 lab passes; zero type errors/warnings**. Production build and code/UI inventory pass; the shared source-style list now has 35 modules. The added guarded database preference test is supplementary; native actual-copy acceptance is separate. The local lab explicitly marks opt-out padding scenarios and retains its independent default behavior.

The native integration harness requires `COAST_READING_ACTUAL_MANIFEST` and `COAST_READING_AUDIT_OUTPUT`, and refuses database names outside `coast_reading_audit_…`. Use only an owned disposable actual-data copy with the existing authorized encrypted-data directory; do not start a worker or point it at a normal/production database. Its controlled reset/party/friendship/state writes are intentional test operations on that copy. Keep media, raw actor/source payloads, screenshots, restore dumps and credentials out of Git.

Recheck progress ownership/cancellation, default/Off/reset persistence, original versus preserved face mapping, activity freshness/closed history and canonical party positions whenever these owners change. Share links remain playback-only; a reading party still requires each participant's own matching authorized edition. Stage feedback and blur are UX changes, not measured loading-speed improvements.
