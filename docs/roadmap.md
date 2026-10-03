# App follow-up roadmap

Updated 3 October 2026. Parked entries record deferred work, not implementation authorization.

## Selected audit pass — implemented

- Audit unused modules/exports/props/styles and consolidate repeated component logic while preserving the approved design.
- Improve keyboard, focus, loading announcements and responsive accessibility; verify representative journeys.
- Exercise actual audio/video playback on desktop/mobile layouts, buffered outages and transitions; distinguish synthetic browser evidence from live-device acceptance.
- Ship a scoped, token-authenticated read-only public API for catalogue, Collection, Library and personal progress. Writes and provider connector APIs remain outside this first pass.
- Hide confirmed empty default rows; show skeletons while loading; retain errors and user-selected empty filters so recovery remains reachable.

Implementation and verification limits: [selected follow-ups](audits/2026-10-03-selected-follow-ups.md). Live-device/provider acceptance is separate from the completed fixture checks.

## Parked audit follow-ups

- Real-account provider/social certification: reconnects/account switching, projection cleanup, genuine sync conflicts, social privacy and taste results across actual integrations.
- Exercise the bundled-volume backup/restore procedure on the actual deployment. Logical database/key recovery was already tested.
- Revisit reviewed transitive dependency advisories when compatible parent upgrades are available.
- Dynamic For You: explore useful personalised rows and exact-next-item prioritisation. “Recently watched”, “From your library” and “Because you watched” have been removed; Activity remains the last row.
- Explore modal media details and preservation of filters, loaded rows and scroll.
- Revisit friend-avatar meanings with explicit design approval.
- Public API writes, webhook/idempotency support, external provider connector grants and protocol negotiation.

## Existing future work

- Wider social roadmap: see [social.md](social.md), including recaps, collaborative lists, groups, gamification and possible chat features.
- Jellyfin account provisioning, richer invitations and disposable public sharing.
- Synced chat/reaction overlays, books/comics, guest/public sessions and wider real-device parity.

Coast username/password registration, removal of Jellyfin sign-in, administrator signup/provider requirements, initial Jellyfin/Trakt import gating and optional uploaded/connected-service profile pictures have shipped. These are no longer pending roadmap decisions.
