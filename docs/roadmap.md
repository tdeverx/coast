# App follow-up roadmap

Updated 4 October 2026. Parked entries record deferred work, not implementation authorization.

## Selected audit pass — implemented

- Audit unused modules/exports/props/styles and consolidate repeated component logic while preserving the approved design.
- Improve keyboard, focus, loading announcements and responsive accessibility; verify representative journeys.
- Exercise actual audio/video playback on desktop/mobile layouts, buffered outages and transitions; distinguish synthetic browser evidence from live-device acceptance.
- Ship a scoped, token-authenticated public API for catalogue, Collection, Library and personal progress. The initial read-only pass is now extended with scoped writes, idempotency and signed webhooks; external provider connector grants remain deferred.
- Hide confirmed empty default rows; show skeletons while loading; retain errors and user-selected empty filters so recovery remains reachable.

Implementation and verification limits: [selected follow-ups](audits/2026-10-03-selected-follow-ups.md). Live-device/provider acceptance is separate from the completed fixture checks.

## Parked audit follow-ups

- Next major pass: codebase-wide optimisation and performance profiling, with focused automated tests and optional user-assisted acceptance. Measure CPU/RAM spikes, query latency and concurrency, provider/background work, rendering, playback and caches under realistic workloads. Prioritise slow Collection requests, the production HTTP idle timeout, and durable child-process exit diagnostics from the live outage investigation; compare measured before/after results. Follow the [isolated investigation and repair plan](audits/2026-10-03-performance-plan.md).
- Add an administrator benchmarking section to the performance pass: one Run benchmark button, recorded results and durable run history to compare performance drift over time. Use repeatable workloads and record build, environment, duration, query latency, CPU/RAM and failures so comparisons remain meaningful.
- Real-account provider/social certification: reconnects/account switching, projection cleanup, genuine sync conflicts, social privacy and taste results across actual integrations.
- Exercise the bundled-volume backup/restore procedure on the actual deployment. Logical database/key recovery was already tested.
- Revisit reviewed transitive dependency advisories when compatible parent upgrades are available.
- Refine Dynamic For You and its exact-next-item prioritisation. “Recently watched”, “From your library” and “Because you watched” have been removed; Activity remains the last row.
- Review the disabled-by-default modal media details experiment; expand navigation/context restoration after design approval.
- Revisit friend-avatar meanings with explicit design approval.
- External provider connector grants and protocol negotiation. Scoped public API writes, idempotency and signed webhooks are implemented.

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
