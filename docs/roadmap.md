# App follow-up roadmap

Updated 3 October 2026. Parked entries record deferred work, not implementation authorization.

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
- Refine the disabled-by-default Dynamic For You experiment and its exact-next-item prioritisation. “Recently watched”, “From your library” and “Because you watched” have been removed; Activity remains the last row.
- Review the disabled-by-default modal media details experiment; expand navigation/context restoration after design approval.
- Revisit friend-avatar meanings with explicit design approval.
- External provider connector grants and protocol negotiation. Scoped public API writes, idempotency and signed webhooks are implemented.

## Existing future work

- Wider social roadmap: see [social.md](social.md), including recaps, collaborative lists, groups, gamification and possible chat features.
- Wider invitation/onboarding design approval and real-server provisioning certification. Signup links, invitation-scoped Jellyfin provisioning and permission-controlled single-use playback links are implemented.
- Synced chat/reaction overlays, books/comics, guest/public sessions and wider real-device parity.

Coast username/password registration, removal of Jellyfin sign-in, administrator signup/provider requirements, initial Jellyfin/Trakt import gating and optional uploaded/connected-service profile pictures have shipped. These are no longer pending roadmap decisions.


## Four experiments — first passes implemented

Independent administrator toggles are disabled by default: Dynamic For You (on-demand vertical feed of personalised horizontal rows), Planning/calendar (scheduled plans and Upcoming on For You for watchlisted titles/tracked shows), personalised recommendations (direct personal evidence against shared catalogue, with explanations), and modal media details (edge-to-edge hero and existing detail rows, opens after loading, shallow navigation). New treatments remain marked unapproved. Refinement and live acceptance remain future work, rather than silently enabling these features.
