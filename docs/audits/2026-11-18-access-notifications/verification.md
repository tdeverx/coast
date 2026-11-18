# Coast access, subtitle and notification follow-up

The reviewed source starts at `e42f4c063ac7208670b1c801b0c5cc5528653331`. These checks cover the affected workflows using an isolated PostgreSQL 17 snapshot of the live Coast database and a local dev server. Provider maintenance was paused on the copy.

## Access and Jellyfin evidence

- The live invite check found two active Coast admins with zero member grants. Dev HTTP checks returned 200 for the Accounts invite page and admin invite API, 409 for an admin submitting a member invite request, 403 for member access to admin invites, diagnostics export and subtitle review, and 401 for an unauthenticated admin API request. The library-only boundary is covered by database fixtures.
- A temporary Jellyfin dashboard API key was verified against the configured server and stored only as ciphertext in dev. Coast issued, resolved and revoked a managed invite using the key. The OpenSubtitles search returned eight results. The upstream key was revoked.
- One real subtitle download reached Jellyfin's file-save step. Jellyfin then logged repeated `FfmpegException` failures from its media probe and returned no new subtitle stream. Coast reported an unconfirmed download. This limits real-provider evidence for playback selection and external subtitle removal on that source. The test attempted to add one sidecar to the Jellyfin media item.
- The server-key generation fences unclaimed invitations and subtitle tickets. Regeneration issues a code for the currently configured key. Pending claims and established managed accounts remain bound to the same Jellyfin server. Remote access is checked using the viewer's own account before delegated search or download.

## Sync and notification evidence

- Four copied aggregate Jellyfin reconciliation jobs completed without reaching a remote playback write. Watched state for a show or season derives from episode records.
- The copied Steam metadata pass checked 209 Steam IDs, refreshed 140 match records, deferred 61 unmatched IDs and left six conflicting matches for admin review. The probe wrote metadata only to the copy.
- Durable backend failures and conflicts route to active Coast admins. Viewer notices cover personal recovery actions such as reconnecting their account or reviewing an undelivered request. A retry that succeeds clears outstanding job feedback. The acted-upon connection and job links follow their respective access boundaries.
- Missing optional provider details use a bounded short cache. A details view reports one failure per affected provider and title. Browser reconnect handling repeats one safe read and coalesces duplicate feedback. Acknowledged writes keep their result when a follow-up refresh fails.

## Performance review

- Authority lookup uses the selected connection or server ID. The invite picker makes zero provider calls on render. The subtitle review list loads on demand and returns at most 40 records. Subtitle choice adds one indexed lookup on eligible playback preparation and one bounded outcome per selected track.
- Link copy eligibility is evaluated for the owner's bounded list. The authoritative copy and claim checks still enforce current source access. Request status notifications batch title hydration only when there are notices. Party reminders select recipients in one bounded query.
- The database sampler runs after selected requests exceed four seconds, at most once per minute per process. It records time to acquire its own connection, the probe query round trip, active backend query ages and outstanding queue reservations. These are separate measurements and do not identify what the completed request was waiting on.
- The replay and fixture results cover the relevant conditions on the tested data. Production tail latency and Jellyfin playback on the unconfirmed test source remain open.
