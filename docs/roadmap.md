# App follow-up roadmap

Updated 11 October 2026. Planned and parked entries record priorities, not delivered features or implementation authorization.

## Highest priority — recovery, reliable backups and data ownership

- Establish scheduled, consistent database backups paired with the matching credential key and durable app files. Keep a versioned manifest with capture time, application/database versions, migration state and checksums; protect backups with appropriate access control and encryption. Define retention, independent storage, capacity checks and visible failure/staleness alerts. A Git checkpoint or live sparse-volume copy is not a verified database backup.
- Verify each backup and regularly restore into a fresh isolated PostgreSQL instance. Test decryption with its paired key, schema/integrity checks, history/Collection/progress preservation and queued work. Publish recovery-point/recovery-time targets and a runbook for graceful shutdown, offline preservation and restore; never treat a damaged original as a working rollback. Exercise the actual bundled-volume procedure as well as the existing logical database/key fixture tests.
- Add an administrator export for explicitly selected installation/user data with reauthentication, authorization, an audit trail, bounded asynchronous generation, private storage, expiration and cancellation. Separate portable data export from disaster-recovery backups; exclude credential keys, passwords, session/API/provider tokens and raw diagnostics from ordinary exports. Define whether any cross-user personal data is included and require an explicit administrator choice.
- Add user self-service exports of their own Collection, lists, ratings, history, progress and account/profile data in documented, versioned portable formats. Scope every query and download to the authenticated user's permitted data; exclude other users' private activity, provider credentials and installation secrets. Test ownership boundaries, revocation, bounded memory/disk usage and expiring downloads. Export enables users to manage their data; deletion/import are separately designed operations.

These requirements are selected roadmap priorities. Backup scheduling, installation restore and admin/user export features are not implemented by the diagnostic changes.

## Selected audit pass — implemented

- Audit unused modules/exports/props/styles and consolidate repeated component logic while preserving the approved design.
- Improve keyboard, focus, loading announcements and responsive accessibility; verify representative journeys.
- Exercise actual audio/video playback on desktop/mobile layouts, buffered outages and transitions; distinguish synthetic browser evidence from live-device acceptance.
- Ship a scoped, token-authenticated public API for catalogue, Collection, Library and personal progress. The initial read-only pass is now extended with scoped writes, idempotency and signed webhooks; external provider connector grants remain deferred.
- Hide confirmed empty default rows; show skeletons while loading; retain errors and user-selected empty filters so recovery remains reachable.

Implementation and verification limits: [selected follow-ups](audits/2026-10-03-selected-follow-ups.md). Live-device/provider acceptance is separate from the completed fixture checks.

## Parked audit follow-ups

- New-user Library experience: explain the difference between connected libraries and personal Collection, guide users while initial imports run, and make an empty Collection useful without hiding the server catalogue. Collection filtering now defaults off in Library; revisit a more helpful first-run experience when selected.

- Profile comparison / versus view: parked after the first design exploration was rejected. Revisit side-by-side profile identities, blended backgrounds and per-medium comparison charts only when selected again; reuse approved UI and respect profile privacy. The first-pass button, route and comparison implementation have been removed.

- Activity feed card lookup: a page can reference 60 activities plus parent shows, while `workCards` currently limits screen cards to 60 total. Fetch explicit IDs in bounded batches before revisiting feed pagination; investigate whether this omission causes entries to disappear between refreshes. Parked at the user's request.

- Next major pass: codebase-wide optimisation and performance profiling, with focused automated tests and optional user-assisted acceptance. Measure CPU/RAM spikes, query latency and concurrency, provider/background work, rendering, playback and caches under realistic workloads. Prioritise slow Collection requests, the production HTTP idle timeout, and durable child-process exit diagnostics from the live outage investigation; compare measured before/after results. Follow the [isolated investigation and repair plan](audits/2026-10-03-performance-plan.md).
- Add an administrator benchmarking section to the performance pass: one Run benchmark button, recorded results and durable run history to compare performance drift over time. Use repeatable workloads and record build, environment, duration, query latency, CPU/RAM and failures so comparisons remain meaningful.
- Real-account provider/social certification: reconnects/account switching, projection cleanup, genuine sync conflicts, social privacy and taste results across actual integrations.
- Revisit reviewed transitive dependency advisories when compatible parent upgrades are available.
- Refine Dynamic For You and its exact-next-item prioritisation. “Recently watched”, “From your library” and “Because you watched” have been removed; Activity remains the last row.
- Review the disabled-by-default modal media details experiment; expand navigation/context restoration after design approval.
- Revisit friend-avatar meanings with explicit design approval.
- External provider connector grants and protocol negotiation. Scoped public API writes, idempotency and signed webhooks are implemented.

## Small–medium quality-of-life audit — parked

Source audit recorded 5 October 2026. These are proposals, not implementation authorization. Value is rated from 1–5 (5 = broad everyday benefit; 3 = useful occasionally). Size is S (small) or M (medium); size and regression risk are estimates to confirm during implementation. Reuse the existing approved buttons, menus, dialogs and row controls.

| Improvement | Value | Size | Risk |
|---|:---:|:---:|:---:|
| Keep the actual job error visible in Developer mode; show paused retries separately instead of replacing the failure explanation. | 5 | S | Low |
| Clear one Library filter without resetting other selections; clearing genre currently drops other filter state. | 4 | S | Low |
| Prevent duplicate list creation by disabling submission while saving and guarding repeated clicks. | 4 | S | Low |
| Protect unsaved profile and metadata dialog edits, matching the protection already present in Settings. | 5 | S | Low |
| Extend Undo to reversible music/game relationship changes, Collection changes and list removal. | 5 | M | Medium |
| Add a search keyboard shortcut using `/`, ignoring typing inside inputs. | 4 | S | Low |
| Offer recent searches, with individual removal and Clear history. | 4 | S | Low |
| Add password visibility and Caps Lock feedback to login, registration and credential forms. | 4 | S | Low |
| Add explicit Copy buttons for invite links, share links and API tokens instead of relying on input selection. | 4 | S | Low |
| Add Library sorting by title, release date, recently added, personal rating and recent activity. | 5 | M | Low |
| Add saved filter presets for frequently used combinations. | 3 | M | Low |
| Fetch search results beyond the current caps in bounded batches. | 4 | M | Medium |
| Add search across the entire friends roster and optional online/active-first sorting. | 4 | M | Low |
| Explain Collection membership in a menu detail: playback, import, list or explicit addition. | 4 | S | Low |
| Allow existing lists to be renamed and their descriptions edited. | 4 | M | Low |
| Add drag rearrangement for ordered lists alongside the existing keyboard-accessible move actions. | 3 | M | Medium |
| Add bulk Library/list relationship actions to save, favourite, collect or remove selected items. | 5 | M | Medium |
| Add personal playback queue reorder, remove, clear and Play next using the party queue's existing patterns. | 4 | M | Medium |
| Extend playback shortcuts to seek, mute, fullscreen and show UI, respecting party permissions. | 5 | S | Medium |
| Remember playback volume per device instead of starting at full volume after remounting. | 4 | S | Low |
| Show the projected finishing time through the existing timeline information. | 3 | S | Low |
| Add optional next-episode autoplay with cancellation, respecting party ownership, availability and progress. | 5 | M | Medium |
| Add a sleep timer for a duration, track or episode, with explicit personal behaviour in parties. | 3 | M | Medium |
| Extend subtitle preferences with size, timing offset and remembered manual choices. | 4 | M | Medium |
| Expose picture-in-picture when supported, maintaining playback through normal navigation. | 3 | M | Medium |
| Add Why this recommendation? using existing taste reasons and confidence in a menu/detail view. | 4 | S | Low |
| Add Not interested and Already seen feedback to influence personal recommendations; friend recommendations already have Dismiss. | 5 | M | Medium |
| Give notifications problem-specific actions: retry transient failures, reconnect accounts or review conflicts directly. | 5 | M | Medium |
| Allow planned items to be rescheduled without cancelling and recreating them. | 4 | M | Low |

Recommended first batch: job error clarity, filter preservation, duplicate-submit protection, unsaved-dialog protection, Undo parity and explicit Copy buttons. Follow with Library sorting, playback shortcuts and recommendation explanations. This ordering is a recommendation, not a selected implementation pass.

Browsing-context restoration remains parked under the modal media details review above: retain loaded rows and horizontal/vertical scroll positions when returning, subject to the media-modal direction and design approval.

## Existing future work

- Wider social roadmap: see [social.md](social.md), including recaps, collaborative lists, groups, gamification and possible chat features.
- Wider invitation/onboarding design approval and real-server provisioning certification. Signup links, invitation-scoped Jellyfin provisioning and permission-controlled single-use playback links are implemented.
- Synced chat/reaction overlays, books/comics, guest/public sessions and wider real-device parity.

Coast username/password registration, removal of Jellyfin sign-in, administrator signup/provider requirements, initial Jellyfin/Trakt import gating and optional uploaded/connected-service profile pictures have shipped. These are no longer pending roadmap decisions.

## Profiles and playback without personal tracking — planned

- Multiple Coast profiles under one account, sharing the owner's permitted Jellyfin sources. Keep each profile's progress, history and recommendations separate. Only the owner's profile exchanges personal tracking with the owner's external accounts; sub-profile activity stays in Coast and must not merge into the owner's provider history. Provider history imports belong only to the owner's profile.
- A watch-without-tracking mode that does not save personal progress, watched history or recommendation activity in Coast, or export personal tracking. Temporary operational playback sessions remain necessary to serve and control playback.
- An administrator-configured Jellyfin guest account per server, required to enable these playback modes while retaining normal Jellyfin admin visibility. Sub-profile playback and playback without personal tracking use the guest account for both stream access and start/progress/stop reports. The owner's ordinary playback continues to use the owner's account.
- Jellyfin still records playback state on the guest account, and administrators see it attributed to Guest. This mode avoids personal tracking; it does not promise an absence of server records. Never import guest history into Coast profiles.
- Preserve the Coast user's source permissions as well as the guest account's permissions: a title must be accessible to both. Use distinct device/session identities for simultaneous playback. Define unavailable, disconnected and insufficient-access guest-account behaviour before implementation; never silently fall back to reporting against the owner's account.
- Verify direct play, transcoding, concurrent sessions and account revocation against a real Jellyfin server, including unchanged owner history and isolated Coast profile tracking. Reuse the approved interface; profile selection and any necessary new controls require design review.

General monitoring of other Jellyfin clients remains a separate discussion. Other clients can use the guest account with normal reporting, but a configured guest account does not restore accurate playback visibility when a client disables reports. Server-side HTTP/FFmpeg monitoring can observe delivery activity, not reliably infer actual viewing, pause state or completion. No monitoring plugin implementation is selected by this roadmap entry.


## For You and remaining experiments

Dynamic For You and personalised recommendations are standard features. The feed loads personalised horizontal rows one at a time at the page bottom, using cached provider suggestions and personal taste signals. Planning/calendar and modal media details retain independent administrator switches, disabled by default. Refinement and wider live acceptance remain future work.
