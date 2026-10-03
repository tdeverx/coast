# Social features — agreed target

Recorded 1 October 2026. The user subsequently authorized implementation of this social target. Deferred passes remain roadmap work. Existing UI components and design remain the foundation.

## First pass

- Mutual Coast friendships, with requests, acceptance, decline, cancellation and removal. Add by exact case-insensitive username; no directory, user search, suggested people or following. Preserve username uniqueness and canonical spelling. Relationships belong to the Coast installation, independently of provider accounts.
- Profile privacy is configured in user settings in the first pass, including shared sections/activity categories. The audience defaults to Friends only, with Public and Private options. Social features and supported presence sharing default on with opt-outs, subject to that audience. Eye controls on profile row headers are deferred to the second pass.
- A friends activity feed covering meaningful watches, listens, game activity, ratings, favourites and supported personal relationship changes. Group episode runs and album activity. Historical imports above the accepted starting threshold of 20 newly imported activity events per batch become an import summary instead of flooding the feed. Preserve underlying event identities and real timestamps; server metadata scans are not personal activity.
- Lightweight reactions to both feed entries and works, using shared work identities across supported media. Start with a small emoji set and one reaction per person per target; changing the emoji replaces the prior reaction, and removing it clears the reaction. No comments, reviews, mentions or spoiler controls in this pass.
- Friend avatars with a +X overflow count on posters/cards, plus friend activity/progress and ratings on media detail pages. In the first pass, a head means the friend has any meaningful personal relationship to the work that is visible to this viewer; it does not mean completion. Metadata presence and empty tracking rows do not qualify. Clear distinctions between relationship/progress/completion meanings and their visual treatments are a second pass requiring manual design approval; do not invent them during implementation. Written reviews remain conditional on a later comments/reviews pass.
- Watching/listening-now presence through actual playback or an explicit manual check-in, enabled by default with an opt-out and governed by profile audience. Explicitly support Trakt API scrobbling for supported screen items. Extend the existing Trakt adapter/outbox scrobble path rather than building another delivery system; preserve connection/account provenance and existing export preferences. Support incoming and outgoing live Trakt events. Manual check-ins follow Trakt behavior, including becoming watched after the runtime elapses unless cancelled; automatic playback uses scrobble start/pause/stop semantics. Apply supported semantics to each concrete media model, without fabricating measured played time for a manual check-in. Presence expires when playback/check-in ends and must not be inferred from an old in-progress tracking row. Support for other media follows their actual activity/session capabilities.
- Friend insights: popular titles, recent discoveries and friend recommendations, shared interests, progress comparisons and overlap. Include a friend taste score, not taste-based user discovery. Calculations use shared data only; define the score, sample-size requirements and handling of sparse data before implementation.
- Send a title recommendation to a friend; receive it through the notification system. Include optional available-only recommendations, assessed using the recipient/viewer's own source access. First-pass responses are Save for later and Dismiss, with no notes. Movie-night acceptance/decline and calendar scheduling belong to the roadmap.
- Extend existing notifications with structured types, destinations, filters, per-type preferences and supported responses for friend requests and recommendations. Responses operate on durable social records rather than treating a notification as the relationship itself. Existing administrator, request, playback and system notifications continue to work.

## Website access and profile audience

Administrators can choose an entirely private website, a private website with public profiles only, or public read-only browsing. Public-profile-only access permits shared profile links and their profile sections/images; Discover, Search, media details and the rest of the app require sign-in. The existing authenticated-only behavior is the private mode; enabling public access is an administrator choice. Public read access does not open registration or add user discovery.

Profile audiences default to Friends only and offer Public and Private. Public means visible to anyone allowed to read that surface under the administrator's website mode: signed-in users in private-site mode and anonymous visitors on designated public surfaces when public access is enabled. Friends-only information remains restricted to accepted friends, and Private remains owner-only. Public website mode does not override a user's audience or category opt-outs.

Anonymous access is read-only. Tracking, reactions, friendship requests, recommendations, notifications, playback and other account actions still require the appropriate authenticated permissions. Never expose personal source access, server inventory or owner-only data merely because trending or a profile can be read publicly. Define the explicit public route/API allowlist during implementation; do not relax authentication globally.

## Live Trakt task

Add an independent live-account task to the existing Trakt service registration and Jobs interface. It checks each eligible linked account on an inactive interval, switches to a more frequent active interval when live activity is detected, and returns to the inactive interval when it ends. The actual interval values are still to be specified; use the existing scheduler rather than a separate polling engine.

Incoming current playback/check-in state and confirmed provider completion must be distinguished from old historical imports. Outgoing Coast playback scrobbles and supported manual check-ins use the existing durable delivery infrastructure. Honor per-account exchange settings, social presence opt-outs, task pause/manual-run behavior, service cooldowns, deduplication, retries, connection ordering and provider account generations. Avoid re-exporting imported provider events or recording duplicate completions. Do not infer that a failed poll means a watch completed; presence needs bounded expiry and explicit source freshness. Historical tracking import, list import and live polling remain distinct tasks/settings.

## UI reuse and approval rule

This is an explicit user constraint, applying throughout implementation:

- Inventory the approved components and their current usages before creating UI. Reuse the newer shared Shelf, Heading, MediaCard, MediaPage, DetailCard, Dialog, Button, RowFilter, SegmentedControl and notification patterns wherever applicable.
- Add domain data/state through the existing composition points. Do not create social-specific copies of shelves, cards, headers, menus, heroes, notification controls or settings layouts merely to add social behavior.
- If an existing component is insufficient, extend the closest approved design while matching its structure, spacing, typography, palette, materials, controls and desktop/mobile behavior. Preserve existing approved uses.
- A necessary new visual treatment or modified design variant must be clearly shown as **Non-approved** in the UI reference, beside the closest approved pattern when useful, so the user can inspect and decide. Do not silently promote a prototype or replace approved production design before its review.
- Keep provisional variants distinguishable from approved examples, and remove rejected or superseded versions after review rather than retaining duplicate implementations.
- The next-pass eye controls and richer avatar/status meanings remain deferred and require their specified design approval.

## Privacy and consistency rules

- Profile privacy is enforced on server reads and every derived surface: feed, avatars, presence, media-page friend information, reactions, statistics, comparisons and recommendations. Making a section/activity category private in settings must not expose the same facts through a different social widget or its counts. Future row controls must edit this same policy.
- Removing a friendship or tightening privacy immediately removes access to protected data, including historical feed reads and cached summaries. Pending requests do not establish friendship permissions.
- Keep existing owner-only game session details and notes private. Aggregate permitted progress/activity is separate from those details.
- Sharing changes do not remove tracking history or alter provider import/export settings. Existing Collection visibility and demand reporting remain separate controls, with demand-sharing opt-outs preserved.
- Availability is assessed for the visitor/recipient; a friend's accessible source does not grant access to somebody else. Social visibility does not grant playback permission.
- Use the shared UI library, work registry, concrete activity models and existing notification/delivery infrastructure. Reuse shelves/cards/headers/menus and lazy bounded loading. Do not add a second scheduler, authentication binding system, or speculative generic social framework.
- Define reactions, feed deduplication/grouping, opt-outs and notification responses once. Reuse those rules for supported media, with concrete activity semantics and existing experimental gates. Future books/audiobooks/comics can extend the work foundation without pretending they are implemented now.

## Confirmed decisions

The user accepted the preceding recommendations and clarified:

- Sharing defaults to Friends only, with Public and Private alternatives; social features remain opt-out within the chosen audience.
- First-pass privacy management is in settings. The eye control on individual profile rows belongs to the next pass.
- Historical import grouping starts above 20 newly imported activity events per batch. Count actual events, not metadata processed or history replayed on reconnect. Preserve the original history and dates, and avoid mass notifications.
- Watching-now supports actual playback and deliberate check-ins following Trakt behavior. Incoming and outgoing live Trakt events are explicitly included, with an independent task using active/inactive account polling intervals.
- First-pass poster/card heads indicate any permitted meaningful relationship to the media, without completion/status badges. Expanded meanings and design need manual approval in the second pass.
- One privacy policy applies across profiles and derived social surfaces. Existing private game session details remain private; social sharing does not silently enable provider exports.
- Notification responses act on durable underlying records; read/dismiss state is separate from accepting a friendship or acting on a recommendation.
- Friend statistics and taste scores must explain their basis and show insufficient-data states rather than inventing precision.
- Administrators choose private-site mode or public read-only surfaces. User privacy still defaults to friends and takes precedence over public-site access.
- Reactions start with a small emoji set and one reaction per person per target.
- Recommendations have Save for later and Dismiss responses, with no notes in this pass.
- UI reuse and closely matched design are mandatory; necessary new design variants are explicitly Non-approved until reviewed.

## Details to make concrete before implementation

The audience, reaction cardinality, check-in behavior, bidirectional Trakt scope and recommendation response choices are settled. Specify the initial emoji set, live active/inactive polling intervals, exact designated public routes, friend metrics/taste-score calculation and feed/friend-management placement in the implementation plan. Use existing UI and obtain review for any genuinely new design variant. These details do not authorize additional features from the roadmap.

## Roadmap

### Second social pass: profile controls and avatar meanings

Add the owner-only eye control to profile row headers, editing the same privacy settings as the first pass. Define richer avatar/status meanings for leaf and parent works and obtain manual approval of their visual design before implementation.

### High priority: social recaps — separate pass

Daily, monthly and end-of-year summaries across media, with different detail levels and optional sharing. Preserve privacy and real event dates. This is a dedicated follow-up, not part of the initial feed implementation.

### Gamification — separate dedicated task

Challenges, achievements, streaks and other gamification are explicitly wanted, with their own product/design pass. Define meaningful achievements across media, repeat activity, unknown dates and imports deliberately rather than adding incidental badges to social work.

### Invites and onboarding

Account invitation links are tentative roadmap work under invites and onboarding, potentially an alternative to jfa-go; they are excluded from the first social pass. The selected share-link roadmap includes permission-controlled disposable links for a particular item that a friend can watch alone or together. Define recipient identity/access, expiry, revocation and source permissions in that pass; do not bypass existing playback authorization. This invitation/share-link roadmap is separate from the approved administrator-controlled public read-only website mode; it does not grant anonymous playback by itself.

### Lists, planning and groups

- Browse friends' lists and collaborative lists.
- Shared queue planning, polls, groups, group feeds and group lists.
- Clubs and organised discussions.
- Movie-night recommendations with accept/decline responses; investigate a larger calendar for upcoming events/releases. Calendar scope remains to be decided.
- Group recommendations and personally explained recommendations, building on permitted taste/overlap data.

### Shared playback

Robust synchronised watching and listening are approved follow-up targets, with future books/comics considered when those media exist. Plan source/access compatibility, session leadership, joining/leaving, playback drift, seeking and reconnects together. Co-watching presence and shared listening sessions belong here. Consider an in-session chat/reaction overlay; it does not establish approval for ordinary direct messaging.

### Optional or undecided

- Friends shelf: possible later, excluded now.
- Comments/reviews, mentions and spoiler protection: revisit later, excluded now.
- Mute/block: may be revisited; excluded now.
- Ordinary direct messages: undecided.
- Following, user discovery/search and reporting: excluded from the selected target.
- Cross-instance friendships and friend-informed demand: not selected in this discussion; do not silently add them to the roadmap or first pass.

## Implementation and review notes

The first pass is implemented without new production dependencies. The user has authorized pushing and merging the implementation; live Trakt acceptance remains deferred. The provisional three-head +X treatment is permitted for use but remains explicitly Non-approved in the UI reference. Heads overlap by 16px at a 32px diameter. Richer avatar meanings still require the second-pass design review.

Edit profile can import the owner's profile icon from a connected Jellyfin or Trakt account. It uses the existing crop/save flow and stores a local image in Coast; it does not continuously synchronize provider avatars. Provider requests remain authenticated and owner-only.

Jellyfin source formats use its WebP conversion path. GIF is a deliberate upstream conversion exception, so the relay also accepts GIF87a/GIF89a bytes. GIF upload and provider import keep the original animation with the existing 5 MB limit. GIFs are stored under the Coast data directory and served through profile visibility checks; social responses carry a local URL. Other images retain the existing square WebP crop. Replaced GIF files are removed after successful profile saves.

Provider behavior has fixture coverage. Live Trakt acceptance remains deferred and must be reported separately from fixtures.

## Follow-up sequencing — 2 October 2026

Real-account social validation and friend-avatar meanings remain deferred. Avatar design changes require the user's explicit approval. See [the app follow-up roadmap](roadmap.md) for the current priorities.


### Follow-up implementation — 2 October 2026

Private friend video/music sessions are now implemented behind the existing Experimental features policy. Simple expiring single-use invitation codes and existing-account Jellyfin onboarding are implemented separately, with main-site access gated on the initial user activity import. See [synced experiences and onboarding](synced-experiences.md). Public disposable item links, Jellyfin account provisioning, chat overlays and future-media synchronization remain roadmap work.
