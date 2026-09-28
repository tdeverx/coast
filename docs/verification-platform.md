# Platform verification

Verified on 27 September 2026 with Bun 1.4.2. This is evidence for the platform boundaries; it does not establish live provider compatibility or an overall 1.0 release candidate. Operational instructions are in [Deployment](deployment.md).

## Automated checks

`tests/platform-security.test.ts` passes nine tests covering:

- Denial of loopback, metadata, link-local, multicast, IPv4-mapped IPv6 and transition-network addresses, including when private LAN access is approved.
- Explicit private-network approval, public address handling, protocol/port approval and reverse-proxy path containment.
- Redirect rejection, decoded body limits, proxy bypass and removal of browser cookies from provider requests.
- Same-origin CSRF checks, server-side administrator guards, random hashed session tokens, AES-GCM encryption with tamper rejection and diagnostic credential redaction.
- Bounded exponential queue retry delays.

`tests/platform-db.test.ts` passes nine additional tests against the isolated `coast_platform_test` PostgreSQL database. Together the suites contain 115 assertions. Transactional checks cover:

- Concurrent first-run attempts create exactly one administrator; ordinary accounts cannot create users or read administrator diagnostics; administrators can create additional administrators; duplicate usernames return a validation error.
- Argon2-backed sign-in, session token hashing, rotation, concurrent-request grace and expiry.
- Parallel queue claims preserve ordering within a user/connection lane while permitting an independent lane.
- Pending compaction retains ordering and does not replace a running action.
- Transient backoff, permanent-failure blocking, retry, cancellation ownership and failure-notification resolution.
- Administrator notification policy overriding user silencing.
- Recovery of an expired worker lease before later work in that lane.
- Startup recovery file consumption, no rereading after startup, one successful password reset and rejection of the disposable session in a fresh process.

Queue state transitions and their corresponding notices commit in the same transaction. Native Bun SQL JSONB writes are checked as objects, including claimed action payloads, rather than accepting a JSON-encoded string as equivalent.

## Rendered browser checks

The fixture journeys below are historical evidence from before the later two-player and context-menu revisions. They do not verify the current control layout. The browser scripts were updated and type-checked during housekeeping; those complete fixture journeys have not been rerun. Current source verification and the read-only rendered checks are recorded in [Readiness](readiness.md#housekeeping-follow-up).

`scripts/browser-check.ts` passed against a fresh, isolated `coast_browser_test` database and localhost:5175 using Playwright Chromium 153. The Browser plugin was unavailable, so the explicitly permitted Playwright fallback was used. Only synthetic local credentials and titles were used.

- First-run setup, sign-in and sign-out work with pointer interaction.
- Creating a native title adds it to the watchlist. Watched status, favourites and a half-star rating persist after reload.
- A new list accepts the title and displays its membership.
- Personal presentation changes work; an administrator shared-title override and lock take precedence, and the personal locked field is disabled.
- Appearance preferences persist, including full-width layout and region.
- Desktop 1440 × 1000 and mobile 390 × 844 pages render without an error overlay or horizontal overflow. Mobile account navigation and sign-in work.
- The final run reported zero browser console errors, warnings or unhandled page errors.

The run discovered two UI issues that were fixed and retested: delayed metadata loading could overwrite edits, and account-menu dismissal could remove the sign-out form before submission. The initial embedded-browser pointer issue was not reproduced in independent Chromium.

Evidence is saved locally outside the repository in `/tmp/coast-browser-evidence`: `setup-desktop.png`, `details-desktop.png`, `settings-desktop.png`, `details-mobile.png`, `account-menu-mobile.png`, `settings-mobile.png`, `home-mobile.png` and `console.json`. The harness waits for the target route and disables finite animations when capturing screenshots.

`scripts/browser-playback-check.ts` also passed against the local synthetic Jellyfin fixture. It verified a muted hero trailer with pause/resume, the same video element handing off from hero to full playback, decoded direct MP4 playback, the subtitle preference prompt, actual text-track off/on changes, one persistent video element across Library navigation, saved position and resume, selection of the HLS edition, and mobile hide/show controls. Seeking to 58 seconds and allowing a real `ended` event produced the saved-history post-play screen and a Watched status. No browser errors or warnings occurred.

Chromium 153 advertised native HLS support and exercised that path. A separate controlled run set only HLS MIME responses from `canPlayType` to unsupported, emulating a browser without native HLS. The app then used its real `hls.js`/MediaSource fallback, decoded the synthetic stream, advanced playback and completed it. This is a simulated capability test, not a claim about a second browser engine. A separate focused Home-to-Details check clicked the same title’s shelf link and preserved both the video element and trailer URL; playback time advanced from 2.029894 to 2.080667 seconds without restarting. Its evidence is `hero-home-detail-continuity.json` and `hero-home-detail-continuity.png` in the same directory.

Playback evidence in `/tmp/coast-browser-evidence`: `player-desktop.png`, `player-hls-desktop.png`, `player-mobile.png`, `hero-trailer-desktop-hlsjs.png`, `player-hls-desktop-hlsjs.png`, `postplay-mobile-hlsjs.png`, `playback-console.json` and `playback-console-hlsjs.json`. The images show a deliberately plain synthetic video and subtitle cue, not production artwork. Screenshots were inspected at desktop and mobile sizes.

A subsequent lifecycle regression pass found and fixed two issues: opening the subtitle prompt prematurely reported playback, and a previously watched movie discarded a new rewatch position. The browser now verifies prompt cancellation sends only a stop for the prepared session, actual playback sends its start, an interrupted rewatch resumes its saved position, and completion changes the action back to Play. Direct playback, native HLS, the hls.js fallback, desktop/mobile controls and completion passed with no browser errors or warnings. PostgreSQL checks also cover concurrent starts, rollback when the first outbound start insert fails, pause/resume ordering, and stale edition positions. Partial rewatches return to Continue Watching while retaining canonical watched status and the previous play count.

The fixture now also exposes a typed Jellyfin series, season, two regular episodes and one special. The extended browser journey passed show hero Play S01E01 → actual ended event → post-play Play S01E02 → stop near 18 seconds → show hero Resume S01E02 → actual completion. It verified the canonical media IDs selected by each action and retained the same video element throughout. Completing the two regular episodes marked the show watched with two of two episodes complete, while the special stayed unwatched. The run repeated the movie/direct/native-HLS/mobile checks and reported no console errors or warnings. Screenshots `episode-next-desktop.png` and `show-completed-desktop.png` were visually inspected. This added verification changed only the test fixture, browser harness and documentation; the application code and last OCI image remain unchanged.

## OCI runtime checks

The complete Dockerfile built successfully as a Linux arm64 OCI image using Apple's local `container` tooling. The full runtime checks below used OCI manifest-list digest `sha256:831d2594e0793a6e647f44bae959fbb495da8ada1646baae889ed7056ee3c9d5`, including the corrected JSONB codec, both migrations and distribution notices. That build output is saved locally at `/tmp/coast-oci-build-final.log`. Two disposable app containers were exercised on loopback ports 3300 and 3301:

1. **Bundled database:** PostgreSQL 15.19 initialised under the single data volume; migrations succeeded; the application became healthy. The Coast database role was confirmed non-superuser and the database encoding was UTF-8. First-run setup, login, HTTP-only/SameSite cookie flags, HTTP LAN logout, CSRF rejection and denial of administrator operations to an ordinary user passed.
2. **External database:** `DATABASE_URL` connected to a separate temporary PostgreSQL database. Migrations, health, setup and the same authentication/permission checks passed. No bundled `/data/postgres` directory was created.
3. **Persistence:** a graceful stop shut down both the app and PostgreSQL cleanly. Restarting with the same volume retained the accounts and accepted sign-in.
4. **Recovery:** the temporary credential file was deleted during startup before any HTTP request. The password reset succeeded, the new password worked, and the consumed credential was rejected.

The final validation also confirmed two applied migrations, preference round-trips stored as a JSONB object, external mode omitting `/data/postgres`, and the license/third-party notice files inside the image. The two app test containers and their disposable volumes were removed after validation. No existing user containers or data were modified. The local OCI build cache remains available for subsequent builds.

After the playback lifecycle and rewatch fixes, the image was rebuilt as `coast-new-container-test-image:latest` with manifest-list digest `sha256:6f7f18a4c4ba1bd8d3eb182dd200fff8881794d04c492e9e36fe7e5c09592e52`. A focused smoke check returned HTTP 200 and healthy status in both bundled and external PostgreSQL modes. The fresh bundled database had two migrations, UTF-8 encoding, a non-superuser Coast role and no seeded users; external mode had two migrations and no `/data/postgres` directory. These unchanged authentication flows were not rerun in that focused check. Logs are `/tmp/coast-oci-build-followup.log`, `/tmp/coast-oci-health-followup.log`, `/tmp/coast-oci-bundled-followup.log` and `/tmp/coast-oci-external-followup.log`.

A real HTTPS request to a public test endpoint also succeeded through `secureProviderFetch`, exercising Bun's checked-address connection with the original TLS hostname. No provider credentials were used.

## Remaining environment checks

- Docker Engine/Compose itself and a Linux amd64 image have not been exercised here; the tested runtime is Linux arm64 OCI through Apple's tooling.
- A real TLS reverse proxy, backup restore and PostgreSQL major-version upgrades have not been exercised.
- The isolated platform tests do not establish live provider compatibility. Subsequent live Jellyfin, TMDB and Seerr checks are recorded below and in [Readiness](readiness.md); Trakt remains unconfigured.
- No image was published or deployed.

## Live-provider follow-up

User-configured Jellyfin 12.1.0, TMDB and Seerr 3.4.1 exposed differences not represented by the original fixtures: Jellyfin's product name is `Jellyfin Server`, stream URLs use hyphenated GUIDs for compact catalogue IDs, collection membership is not a movie identity, and mapped Seerr accounts may have a null username. Focused regressions now cover those boundaries. Discovery also resolves fetched shelf IDs directly, so concurrent library imports cannot displace them from the rendered result.

With the user's explicit permission, “Wild Cities” played through Jellyfin HLS for 9.62 seconds. The session stopped normally, Coast retained that position with watched=false and play count zero, and a reload displayed Resume S01E05. Screenshot evidence: `/tmp/coast-live-jellyfin-resume.png`. The live discovery accessibility tree then showed 20 trending and 20 recent results. Live checks used the Codex in-app browser; the earlier fixture journeys provide the recorded console and responsive coverage.

The completed scan and follow-up metadata repair left zero collection identifiers in the movie-identity table and zero movie roots with multiple TMDB identities. The repair retained nine original roots, created 13 distinct movie roots, preserved 22 provider-item and availability row IDs, and restored five collection memberships. All personal rows on the affected playback retained identical before/after hashes. The successful transaction's private backup is `/tmp/coast-jellyfin-identity-backup-2026-09-27T11-17-10.185Z.json`; two earlier attempts rolled back fully before the successful apply. No credentials were backed up or changed. All six queued Jellyfin playback events succeeded. A read of the test episode's remote state showed position zero, Played=false and PlayCount=1, so only Coast resume retention and Jellyfin event delivery are claimed. The final corrected details page rendered The Avengers (2012), its exact matching source and Resume Movie.

The image was rebuilt after these source fixes as `coast-new-container-test-image:latest`, manifest-list digest `sha256:048f2e57ea96e8695d1430259a557c56762bfb969d0da1c5aa1ef69401d8043a`. Both isolated PostgreSQL modes returned healthy HTTP 200 with two migrations. The fresh bundled database was UTF-8 with a non-superuser Coast role and no seeded users; external mode did not create a bundled PostgreSQL directory. Test resources were removed and the live preview database was untouched. Logs: `/tmp/coast-oci-build-livefix.log`, `/tmp/coast-oci-health-livefix.log`, `/tmp/coast-oci-bundled-livefix.log`, `/tmp/coast-oci-external-livefix.log` and their sanitized runtime excerpts.
