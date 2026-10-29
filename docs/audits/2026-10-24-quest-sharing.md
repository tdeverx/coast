# Quest sharing: format detection before playback

24 October 2026. Investigation of Coast VRChat links against the existing VRRelay installation and source. The correction is implemented, tested and **deployed to the existing Coast container**. Physical Quest playback verification remains pending. Earlier bulk-recovery work remains separate and uncommitted.

## Observed failure

The retained Nginx Proxy Manager access logs contain eight requests on **20 October 2026, 12:55:10–12:59:25 BST** from `AVProMobileVideo ... (Linux;Android 14) ExoPlayerLib/1.8.0`. All eight requested Coast's extensionless `/share/{grant}` entry and received **HTTP 200**, with 1,594–1,599 response bytes. None was redirected. No child playlist/segment requests from that Android user agent appear in the retained logs.

During that same hour, Windows Media Foundation made four entry requests and 205 resource requests. Both client types requested the same two grants, compared by one-way hashes without retaining bearer values. Read-only live database inspection found the corresponding Android-timed shared sessions still at position zero. This is evidence for failure at initial media-source selection/parsing, before video decoding; it does not establish a decoder incompatibility.

`vrrelay.local` did not resolve. Local configuration located the existing native VRRelay process, its configured HTTPS origin and the matching reverse-proxy host. Its source is `/Users/admin/Documents/VRR`; no relay configuration, profile or database was changed. VRRelay exposes `/play/{grant}/index.m3u8` and MPEG-TS segment paths. Its compatibility policy specifies H.264 8-bit, AAC-LC stereo and MPEG-TS HLS, and explicitly keeps physical Quest acceptance separate from engineering checks.

## Mismatch and correction

The official [ExoPlayer HLS guide](https://developer.android.com/media/media3/exoplayer/hls#using-mediaitem) requires a `.m3u8` URI or an explicit `MediaItem` HLS MIME hint. The [exact 1.8.0 factory](https://github.com/androidx/media/blob/1.8.0/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/source/DefaultMediaSourceFactory.java) selects HLS from the URI/configured MIME; otherwise it falls back to a progressive extractor. An HTTP response Content-Type alone is not that application-supplied hint.

Coast copied an extensionless URL and does not control the native VRChat player's MediaItem. Returning a valid HLS response is insufficient when the player has selected the progressive source first. This contract mismatch is confirmed in source and is the strongest explanation for the retained request pattern. A device-side exception or successful on-Quest retest is still required for definitive attribution of the observed client failure.

The smallest correction is:

- Generate the single copied/displayed URL as `/share/{grant}.m3u8` through one shared formatter.
- Strip that exact terminal suffix before the existing strict bearer-token validation. Permission, expiry, revocation, viewer allocation and child-resource authorization remain in their existing owners.
- Preserve browser document negotiation to the shared player, HEAD without viewer/encoder allocation, and native cookie-free media delivery. No redirect, encoding, bitrate or infrastructure changes were made.

Existing extensionless entry handling remains; this does not redirect an old extensionless player URL into an HLS filename. After deployment, copy the newly formatted link. The new filename is a format hint, not a stronger capability or a new secret.

## Verification

- **18 native sharing database regressions passed** on an empty, disposable PostgreSQL 17 instance using shipping Linux Bun `6bb5dc195`. The generated `.m3u8` entry validated the same grant, preserved browser negotiation/HEAD behavior, traversed master → child playlist → resource, and retained viewer binding and revocation. Upstream responses in these tests are authored fixtures, not real Quest playback.
- **15 focused tests passed**, then the full supplementary suite passed: **1,027 passed / 742 skipped / zero failed**. Skipped cases are not promoted to acceptance.
- Svelte check, production build and UI inventory passed. The built SvelteKit route matcher was independently checked with a complete suffixed token.
- No new real playback session, encoder or provider job was started. Live data and proxy configuration were only read. The disposable database wrapper removed every test database; PostgreSQL stopped gracefully and the test container was removed.

[Sanitized evidence and source fingerprints](2026-10-24-quest-sharing.json) bind this correction. Do not replace these actual log observations with a browser-only playback claim. Future changes to copied URL generation, entry parsing, HEAD/content negotiation or opaque child grants must rerun the native sharing pipeline tests and the relevant decoder/device acceptance.

## Separate observations and remaining acceptance

Retained shared-resource proxy messages during the October 20 attempts are **buffer-to-temp warnings**, not failed redirects or HTTP delivery errors. Later logs contain read-only proxy-temp failures for unrelated artwork/trailer requests and recurring provider-sync database deadlocks. Those operator issues were not treated as proof of this Quest failure and were not changed here.

A physical Quest test over the existing trusted HTTPS public origin remains necessary: paste the newly generated URL after rollout, confirm child playlist/segment requests, then verify startup, audio/video, pause and seeking. The initial investigation was read-only. The user subsequently authorized the container update recorded below; no commit or PR was created.


## Authorized container update — 24 October 2026

The running `coast` container now uses `coast:quest-20261024-e28708f5eccc`, image digest `sha256:5625d1f4a184a44f37a3587f065ca4581510959b43023996e561b97251b0fc53`, build identifier `fd9bd304-quest-e28708f5eccc`. This is a targeted image from the previously deployed `fd9bd304ef4da3f2f2d5b46bd89df857fe065401` source plus only the three sharing-source changes. Other uncommitted bulk recovery, preview, schema and housekeeping work was excluded.

The exact old runtime image is retained under immutable digest `sha256:ea786f59caae4af3b105bcdff4ed94a7e5699fc78c6810cc9b4e6b32ac6f179f`; Bun remains `6bb5dc195` and PostgreSQL remains 17.11. The existing bind mount, named PostgreSQL volume, host port 7318, public origin, four CPUs, 4 GiB memory and restart policy were preserved. No migration was added or applied during this update. Coast was stopped through its manager to avoid a watchdog restart, and PostgreSQL recorded clean shutdown.

A consistent 264,368,688-byte logical database backup and paired secrets archive were created privately under `runtime/deploy-backups/quest-20261024-e28708f5eccc`. The backup restored into a separate marked staging database with matching user, history, share and connection counts, and a genuine encrypted credential decrypted with its paired key. The directory also retains the exact rollback environment/container specification and corresponding source archive; these private files are not included in this report.

The patched image booted with an empty isolated database. A disabled/disconnected authored source and expired grant verified the real HTTP route: both the original and suffixed URLs reached the same expiration check (410), with zero playback/provider activity. Initial scratch mounting failed on host-directory mode and fresh-volume root metadata; the preflight was recreated using an isolated managed data volume. These staging failures did not stop or modify live Coast.

After replacement, public HTTPS health and internal health returned 200. A retained expired real grant returned 410 through the public proxy with and without the suffix, proving live normalization without allocating viewers or starting an encoder. User/share/source counts and the migration receipt matched their pre-update values. History increased during normal Jellyfin observation: an identity comparison against the backup verified **all 86,394 original events remained**, with 12 new Jellyfin progress events at the verification snapshot and none missing. Thus history preservation is verified; an unchanged live event count is not claimed.

The marked restore was dropped with zero clients. Its staging container and scratch volume were deleted. The manager shows live Coast running. No new Quest playback claim is made: reload Coast, copy the newly formatted link and verify it on the headset after this update.
