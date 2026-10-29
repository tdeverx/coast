# Hosted companion acceptance — 25 October 2026

The local hosted crop and encoder checks pass after repairing cached crop authorization. This is a new evidence epoch, using genuine library data, the actual Jellyfin 12.3.0 executable, FFmpeg 8.1.3 and the current companion. It does not certify physical-device playback, Coast party membership/synchronization, long-session drift or production capacity. [Receipts and source pins](2026-10-25-hosted-companion/pins.json) retain these boundaries.

## Isolation and real data

A consistent SQLite online backup of the running server's real database was hosted on a disposable localhost port. The copy retained 18 user records and the real catalogue; its video query contained 34,687 records. The exercised movie was an existing local file, not generated video. Three copied users, including one administrator, received new clone-only credentials. All copied device/API tokens were deleted and copied passwords replaced before creating those sessions. No live credential was used to authenticate to the copy.

An inherited macOS sandbox denied writes outside the owned temporary directory and outbound connections except to the copy itself. An attempted external write was denied before hosting began. Original media remained read-only. The current companion was loaded only into the copy; live Jellyfin still has companion 0.3.0.0. Its original process remained healthy with HTTP 200 after cleanup.

Automatic approval review rejected an attempted command to export decrypted live credentials; it did not execute. The subsequent fresh-credential approach avoids that transfer. No approval remains necessary for the completed checks. The private snapshot, credentials and server were deleted afterward. [Environment](2026-10-25-hosted-companion/receipts/environment.json) and [cleanup](2026-10-25-hosted-companion/receipts/cleanup.json) record the exact scope.

## Confirmed bug and repair

Before the repair, a user could warm a crop, lose library access, receive 404 from Jellyfin's item endpoint, and still receive 200 with the cached rectangle from the companion. The old cache key isolated credentials but did not recheck item access. [Before observations](2026-10-25-hosted-companion/receipts/authorization-before.json) preserve the failure; that receipt explicitly discloses reconstruction from the retained tool output after the original filename was overwritten by the after-run.

The controller now resolves the authenticated user, current media-playback permission and Jellyfin's user-aware video visibility before cache lookup. Missing identity, a disabled user, playback withdrawal and inaccessible items fail closed. Access is checked again after analysis completes, covering withdrawal while work is running. Analysis sharing, bounds, cancellation and rectangle contracts remain intact. No dependency was added.

The hosted [after-run](2026-10-25-hosted-companion/receipts/authorization-after.json) returns 404 for the withdrawn cached item. The [authorization matrix](2026-10-25-hosted-companion/receipts/authorization-matrix.json) passes anonymous/invalid-token rejection, invalid IDs, two credential cohorts, independent library access, playback withdrawal, disabled users, feature withdrawal/restoration and logout revocation. Jellyfin returns 401 and invalidates sessions when a user is disabled; re-enabling required a fresh clone login. These are actual middleware results, separate from the controlled regression harness.

## Real media and process lifecycle

| Schedule | Observed result |
|---|---|
| Hosted crop deadline with real video deliberately read at 0.05 speed | 502 at 20,031 ms; zero FFmpeg processes after drain |
| Two same-key hosted crop consumers | One FFmpeg process; first abort retained it; final abort drained it in 67 ms |
| Two independent HLS sessions via production `JellyfinAdapter` | Both decoded frames; stopping one preserved the other; final stop left zero processes and no media segments |
| One HLS producer, two Chromium contexts | Both decoded frames; survivor continued; one encoder until final stop; zero afterward |
| Same shared-producer schedule, desktop WebKit and Firefox | Both passed independently; no fatal media errors or external requests |

The crop deadline schedule wraps the real FFmpeg executable to pace its genuine input. It is a forced failure test, not a production-latency benchmark. HLS uses the production adapter's shared-mode playback negotiation and stop-encoding method. Independent sessions decoded 28 and 105 frames before intentional termination. Decoder exit 255 reflects that deliberate termination.

Chromium 156.0.8078.4, WebKit 27.2 and Firefox 157.0 each decoded the shared stream in two isolated contexts. Stopping the last producer left zero encoders and zero media files. Segment deletion completed about 1.51–1.53 seconds after the stop response. The first test incorrectly asserted deletion at 300 ms; its [failed receipt](2026-10-25-hosted-companion/receipts/browser-hls-too-early.json) is retained. The revised probe observes eventual deletion within a fixed five-second test deadline. This is test observation, not a new runtime delay. `.jellyfin-transcode` is a zero-byte ownership marker, not leaked media.

The Browser plugin was unavailable, so the installed Playwright engines performed decoder validation. This is a media harness, not a redesign or whole-page UI acceptance. Two contexts sharing a URL prove producer/consumer lifetime, not Coast's party invitation, host controls or clock synchronization. [Probe transcripts](2026-10-25-hosted-companion/probes/) omit tokens, private media URLs and account identities.

## Regression requirements and remaining work

The companion build passes without warnings. Its executable passes 29 crop checks plus 11 journal checks, including new cached withdrawal, playback withdrawal, disabled/missing identity and in-flight withdrawal cases. Existing single-flight, two-child admission, capacity, expiry, failure/retry and shared/final-consumer cancellation checks remain green. The 57 focused app checks pass. The full app suite passes 1,028 tests, with 742 database/integration tests skipped and zero failures; those skips are not additional integration acceptance. Initial audit-index refresh failures and final outcomes are recorded in [gates](2026-10-25-hosted-companion/receipts/gates.json).

Future changes to permission resolution, authentication claims, crop cache identity, FFmpeg ownership, playback negotiation or stop reporting must rerun the affected hosted schedules and the companion executable. Retain the negative before-run and premature-cleanup assertion. Pin app and companion sources together, record the host/decoder versions, and label generated credentials and forced schedules explicitly. Do not refresh historical measurements as though they ran against new code. Use online backup or a stopped source for snapshots; never copy an active SQLite database without its consistency mechanism.

`BLOCK-HOSTED` is narrowed to Coast party orchestration and multi-device synchronization/drift. The tested local hosted permission, encoder and shared-producer paths no longer require an environment. Physical devices and a real joined Coast party/device schedule remain outstanding under `BLOCK-HOSTED`, `BLOCK-DEVICE` and `BLOCK-COHORT`; no device access was supplied in this run. Unrelated queue-job, format and capacity boundaries remain unchanged. No commit, push, PR or production deployment was performed.
