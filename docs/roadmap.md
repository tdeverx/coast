# App follow-up roadmap

Reviewed 15 October 2026 against the current checkout and implementation reports. This lists remaining work only; implemented features are documented elsewhere, even when not yet published. Parked proposals are not implementation authorization. Fixture coverage does not replace real-provider, deployment or device acceptance.

## Highest priority — recovery, reliable backups and data ownership

- Establish scheduled, consistent database backups paired with the matching credential key and durable app files. Keep a versioned manifest with capture time, application/database versions, migration state and checksums; protect backups with appropriate access control and encryption. Define retention, independent storage, capacity checks and visible failure/staleness alerts. A Git checkpoint or live sparse-volume copy is not a verified database backup.
- Verify each backup and regularly restore into a fresh isolated PostgreSQL instance. Test decryption with its paired key, schema/integrity checks, history/Collection/progress preservation and queued work. Publish recovery-point/recovery-time targets and a runbook for graceful shutdown, offline preservation and restore; never treat a damaged original as a working rollback. Exercise the actual bundled-volume procedure as well as the existing logical database/key fixture tests.
- Add an administrator export for explicitly selected installation/user data with reauthentication, authorization, an audit trail, bounded asynchronous generation, private storage, expiration and cancellation. Separate portable data export from disaster-recovery backups; exclude credential keys, passwords, session/API/provider tokens and raw diagnostics from ordinary exports. Define whether any cross-user personal data is included and require an explicit administrator choice.
- Add user self-service exports of their own Collection, lists, ratings, history, progress and account/profile data in documented, versioned portable formats. Scope every query and download to the authenticated user's permitted data; exclude other users' private activity, provider credentials and installation secrets. Test ownership boundaries, revocation, bounded memory/disk usage and expiring downloads. Export enables users to manage their data; deletion/import are separately designed operations.

These requirements are selected roadmap priorities. Backup scheduling, installation restore and admin/user export features are not implemented by the diagnostic changes.

## Acceptance and reliability

- Real-account provider/social acceptance: Jellyfin video, audio and reading access; Trakt linking, history and live activity; Steam ownership/achievements; Seerr requests, cancellations and partial-season updates. Exercise reconnects/account switching, genuine sync conflicts, privacy and taste results with intentional accounts.
- Validate shared-library onboarding, companion updates and queue recovery under real multi-account load. Measure import throughput, memory and interactive latency; synthetic cache/staging tests do not establish production speed. See [provider job verification limits](audits/2026-10-07-provider-jobs.md).
- Validate playback on physical desktop/mobile devices and multiple party clients, including codecs, autoplay, source transitions, drift, reconnects and HLS outages. Extend representative accessibility checks to real assistive technology.
- Exercise bundled-volume backup/restore on the intended deployment. Disposable logical database/key recovery does not certify an installation restore.
- Continue measured production performance work: investigate remaining CPU/RAM spikes and long-running heap behavior, browser rendering and decoding, cold-cache/network behavior and background contention. Use the existing benchmark history and [performance methods](performance.md); the local benchmark does not cover these workloads.
- Revisit reviewed transitive dependency advisories when compatible parent upgrades are available; confirm current lockfile paths and reachability before changing dependencies.

## Product and metadata follow-ups

- New-user Library experience: explain connected libraries versus personal Collection, guide users during initial imports, and make an empty Collection useful without hiding the server catalogue.
- Activity feed card lookup: a page can reference 60 activities plus parent shows, while `workCards` still caps screen hydration at 60 total. Fetch explicit IDs in bounded batches and investigate refresh omissions. Feed/row-section pagination remains parked until this is resolved.
- Dynamic For You: refine exact-next-item prioritisation and evaluate relevance, diversity and repetition with real user data. Extend the existing lazy rows and cached provider/taste ranking rather than rebuilding the feed.
- Media detail overlay: review the disabled-by-default experiment and, after design approval, preserve loaded rows and horizontal/vertical scroll when navigating back.
- Books/comics: expand real-provider acceptance beyond the verified comic search, verify deployment reader files, and expand author/comic-series entities, provider recommendation sources, trustworthy exact book release dates and operator contact identification for Open Library. Resolve remaining edition/collected-volume/issue identity conflicts with verified evidence, not title matching.
- Reading formats: consider additional archives, Kindle and audiobooks with their own capability/dependency review. Cross-server and local/server file equivalence needs verified content identity; see [reading boundaries](reading.md).
- External provider connector grants and protocol negotiation for the public API.
- Profile comparison / versus view: parked after the rejected design exploration. Revisit identities, blended backgrounds and per-medium charts only when selected again, with privacy and design approval.

## Small–medium quality-of-life audit — parked

Source audit recorded 5 October 2026. These are proposals, not implementation authorization. Value is rated from 1–5 (5 = broad everyday benefit; 3 = useful occasionally). Size is S (small) or M (medium); size and regression risk are estimates to confirm during implementation. Reuse the existing approved buttons, menus, dialogs and row controls.

| Improvement | Value | Size | Risk |
|---|:---:|:---:|:---:|
| Show the last error for a pending retry alongside its waiting/Developer-mode pause reason in task details; failed-task and last-run error displays already exist. | 5 | S | Low |
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
| Expose existing list rename/description commands through the approved list UI. | 4 | S | Low |
| Add drag rearrangement for ordered lists alongside the existing keyboard-accessible move actions. | 3 | M | Medium |
| Add bulk Library/list relationship actions to save, favourite, collect or remove selected items. | 5 | M | Medium |
| Add personal playback queue reorder, remove, clear and Play next using the party queue's existing patterns. | 4 | M | Medium |
| Extend playback shortcuts to seek, mute and fullscreen, respecting party permissions and editable fields. | 5 | S | Medium |
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

### First quality-of-life batch — parked

Parked at the user's request on 14 October 2026. These six proposals have been scoped but are not selected for implementation. Preserve the approved interface and reuse existing controls, mutation helpers, feedback and confirmation methods; no redesign or new dependencies is planned.

1. Job errors: show the last failure for pending retries alongside the waiting or Developer-mode pause reason in existing task details.
2. Library filters: clearing a genre removes only that filter, preserves other selections and resets pagination.
3. List creation: guard repeated submissions and disable the existing Create button while saving.
4. Unsaved edits: protect profile and metadata dialog edits when closing or navigating away, following Settings' confirmation pattern.
5. Undo: reuse the existing Undo notification for reversible music/game relationships, Collection changes and list removal; restore the list position where applicable.
6. Copy buttons: add explicit Copy actions beside invitation links, playback share links and newly generated API tokens, with existing success/error feedback.

Suggested later batch: Library sorting, playback shortcuts and recommendation explanations. The audit's ratings remain estimates; the list-edit row is scoped to its missing UI because server commands already exist.

## Social and shared experiences

- Owner-only profile-row privacy controls and richer friend-avatar meanings require explicit design approval.
- Daily/monthly/yearly recaps; collaborative lists, shared planning/polls, groups and clubs. Challenges, achievements and streaks need a separate product/design pass. See [social roadmap](social.md#roadmap).
- Movie-night recommendation responses, group recommendations and planning/calendar refinement behind its existing switch.
- Wider invitation/onboarding design approval and real-server provisioning acceptance; retain the existing signup and permission-controlled single-use playback links.
- In-session chat/reaction overlays and guest/public party sessions. Ordinary direct messaging, comments/reviews, spoiler protection and mute/block remain undecided, not selected features.

### Unified playback sharing — remaining acceptance

Reusable expiring grants, browser/media resolution, cookie-free HLS resources, per-viewer provider sessions, administrator-controlled personal/shared bitrate limits, durable bitrate handoff and shared-link attribution in Active streams are implemented. See [reusable playback links](synced-experiences.md#reusable-playback-links) for scope, bounds and verification.

- Verify the single copied URL and explicit `?play=1` media selection in actual VRChat/AVPro/Quest over the intended HTTPS proxy, including HEAD probing, seeking, expiry and revocation.
- Exercise active quality changes under real contention and simultaneous seeks; retain duration, audio/video continuity and independent player control. Browser feasibility is evidence for the approach, not native-client certification.
- Verify music-track HLS and bitrate changes on actual target players, including pause/resume and long buffers.
- Measure address/user-agent lease merging/splitting with real worlds; retain estimated labels and avoid claiming unique people or VRChat usernames.
- Evaluate budget margins and configurable quality/concurrency bounds from measured deployments. Negotiated bitrate targets are not exact instantaneous byte limits. Browser ↔ game synchronization remains out of v1.

### Browser ↔ VRChat playback sync — investigation needed, parked

Investigate optional two-way synchronization separately from sharing the media URL. VRChat must retain working play/pause/seek controls; browser-only control or inferring player state from buffered segment requests is insufficient. Establish a feasible world/client integration, separate viewing/control permissions, timeline authority and handoff, command ordering, drift correction, feedback-loop prevention and reconnect behavior. Account for external request limits and validate real clients before choosing an approach. This is not part of v1 and does not authorize implementation.

## Profiles and playback without personal tracking — planned

- Multiple Coast profiles under one account, sharing the owner's permitted Jellyfin sources. Keep each profile's progress, history and recommendations separate. Only the owner's profile exchanges personal tracking with the owner's external accounts; sub-profile activity stays in Coast and must not merge into the owner's provider history. Provider history imports belong only to the owner's profile.
- A watch-without-tracking mode that does not save personal progress, watched history or recommendation activity in Coast, or export personal tracking. Temporary operational playback sessions remain necessary to serve and control playback.
- An administrator-configured Jellyfin guest account per server, required to enable these playback modes while retaining normal Jellyfin admin visibility. Sub-profile playback and playback without personal tracking use the guest account for both stream access and start/progress/stop reports. The owner's ordinary playback continues to use the owner's account.
- Jellyfin still records playback state on the guest account, and administrators see it attributed to Guest. This mode avoids personal tracking; it does not promise an absence of server records. Never import guest history into Coast profiles.
- Preserve the Coast user's source permissions as well as the guest account's permissions: a title must be accessible to both. Use distinct device/session identities for simultaneous playback. Define unavailable, disconnected and insufficient-access guest-account behaviour before implementation; never silently fall back to reporting against the owner's account.
- Verify direct play, transcoding, concurrent sessions and account revocation against a real Jellyfin server, including unchanged owner history and isolated Coast profile tracking. Reuse the approved interface; profile selection and any necessary new controls require design review.

General monitoring of other Jellyfin clients remains a separate discussion. Other clients can use the guest account with normal reporting, but a configured guest account does not restore accurate playback visibility when a client disables reports. Server-side HTTP/FFmpeg monitoring can observe delivery activity, not reliably infer actual viewing, pause state or completion. No monitoring plugin implementation is selected by this roadmap entry.


## Implementation records

Completed work belongs in the [selected audit report](audits/2026-10-03-selected-follow-ups.md), [performance implementation](audits/2026-10-03-performance-implementation.md), [provider jobs report](audits/2026-10-07-provider-jobs.md), [reading guide](reading.md) and [public API guide](public-api.md). Current switches and availability are documented in [experimental features](experimental-features.md). Historical reports retain their dated evidence and limits; they are not an active backlog.
