# Open questions and explicit defaults

The user has configured Jellyfin, TMDB and Seerr. Live Trakt acceptance is deferred at the user's request; the user will perform the real Seerr request checks themselves.

## Recorded defaults

- Accounts are administrator-created after first-run setup; no public registration.
- Default session lifetime is 30 days with activity-based renewal; sensitive operations require a current session.
- Local completion threshold is 90% for movie/episode playback, with explicit manual completion always available. This is an implementation default, not a provider source-of-truth policy.
- Specials are tracked but excluded from automatic show completion.
- New integrations require administrator-approved instances. Arbitrary user servers default off; LAN destinations require explicit approval because self-hosted servers commonly use private addresses.
- External account deletion is opt-in only where an adapter explicitly supports it.
- No existing prototype credentials or user database will be copied into this project.

## Validation requiring external access

Live TMDB, Jellyfin, Trakt and Seerr validation needs intentionally supplied service configuration and accounts. Contract fixtures can verify local behaviour but cannot establish real-server compatibility. Record the remaining live checks in the readiness report; do not mark them passed without evidence.

Live Jellyfin identity, account linking, full scans, short HLS playback and outbound progress delivery now pass. Coast retains the short test's resume position; Jellyfin accepted its events but returned zero resume position afterward. Live TMDB reads and Seerr 3.4.1 identity/permissions/destinations also pass. Trakt linking and synchronization, and real Seerr request mutations, remain unverified. See [Readiness](readiness.md) for precise evidence and limits. Credentials should be entered in Coast rather than chat.

Do not ask again for Trakt configuration or create Seerr requests for acceptance unless the user resumes that work. These checks have not passed; they are explicitly deferred/owned by the user.
