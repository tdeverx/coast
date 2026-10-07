# Open questions and explicit defaults

The user has configured Jellyfin, TMDB and Seerr. Live Trakt acceptance is deferred at the user's request; the user will perform the real Seerr request checks themselves.

## Recorded defaults

- Accounts are administrator-created after first-run setup; no public registration.
- Default session lifetime is 30 days with activity-based renewal; sensitive operations require a current session.
- Local completion threshold is 90% for movie/episode playback, with explicit manual completion always available. This is an implementation default, not a provider source-of-truth policy.
- Music logs a listen after 50% actually played by default. The integer 1–100% preference is captured at session start; seeking, pauses and buffering do not add played time.
- Demand sharing with administrators defaults on with a personal opt-out. Jellyfin activity imports default on; outbound tracking reconciliation is a separate connection opt-in.
- Specials are tracked but excluded from automatic show completion.
- New integrations require administrator-approved instances. Arbitrary user servers default off; LAN destinations require explicit approval because self-hosted servers commonly use private addresses.
- External account deletion is opt-in only where an adapter explicitly supports it.
- No existing prototype credentials or user database will be copied into this project.

## Validation requiring external access

Live TMDB, Jellyfin, Trakt and Seerr validation needs intentionally supplied service configuration and accounts. Contract fixtures can verify local behaviour but cannot establish real-server compatibility. Record the remaining live checks in the readiness report; do not mark them passed without evidence.

Live Jellyfin identity, account linking, full scans, short HLS playback and outbound progress delivery now pass. Coast retains the short test's resume position; Jellyfin accepted its events but returned zero resume position afterward. Live TMDB reads and Seerr 3.4.1 identity/permissions/destinations also pass. Trakt linking and synchronization, and real Seerr request mutations, remain unverified. See [Readiness](readiness.md) for precise evidence and limits. Credentials should be entered in Coast rather than chat.

Do not ask again for Trakt configuration or create Seerr requests for acceptance unless the user resumes that work. These checks have not passed; they are explicitly deferred/owned by the user.

Music direct/HLS playback and desktop/mobile control behaviour have synthetic fixture evidence. Audio from the configured live server remains unverified; prior live Jellyfin video evidence does not establish audio compatibility.

## Deferred UX ideas — 1 October 2026

The user asked to park these ideas for later. They are discussion candidates, not approved implementation requirements or scheduled work. Preserve the current interface until the user resumes this discussion.

### User proposals

- Combine Library and Collection into one browsing destination, with a Collection toggle using the existing availability-toggle pattern.
- Alternatively, move Collection into the profile/account context menu.

### Suggestions discussed for Collection and Library

- Keep personal membership and server availability separate in the data, with independent Collection and Available filters on one page. Both off would show personal items plus accessible server content, excluding unrelated discovery metadata; both on would show their intersection.
- Library now defaults to Collection off and Available off so new users can browse connected libraries before building a personal Collection. Revisit first-run guidance and remembering selections; see the new-user Library roadmap entry.
- Consolidate duplicate availability controls; retain advanced Missing, Unknown, Partial and Ready to continue choices in the existing filter menu.
- Explain why an item remains after removing direct Collected status, using its retained watchlist/history or other membership reasons in existing feedback.
- Present missing demand as an actionable shelf using existing cards/request actions, keeping uncertain access separate from confirmed missing.
- Offer music Continue only when meaningful resumable progress exists, identifying the target track.
- Restore filters, loaded rows and scroll when returning from details.

### Suggestions discussed beyond Collection

- Prioritise exact next actions on For You: resumable items and the next episode/track, with recommendations secondary.
- Explain playback failures as missing content, server outage or denied access, and offer the relevant existing Request, Retry, Choose source or reconnect action.
- Show plain sync outcomes and freshness in personal Connections; leave job identifiers and scheduling mechanics in administrator Jobs.
- Keep watched/listened/played logging placement and feedback consistent while preserving each activity's semantics. Make recorded automatic listens discoverable without interrupting playback.
- Clarify shared Integrations versus personal Connections, including the next setup step, default imports and separate export opt-ins.
- Preserve browsing context and appropriate playback-source/subtitle preferences, avoiding repeated questions already answered.
- Distinguish empty states for no tracking, no matching filters, no linked source and failed server assessment, each with a useful next action.

Suggested priorities were next-action clarity on For You, actionable playback failures and understandable sync feedback. These priorities are also deferred and remain unapproved.
