# App follow-up roadmap

Updated 2 October 2026. These entries record deferred work, not implementation authorization.

- Explore media detail pages in a modal view before deciding how filters, loaded rows and scroll should survive opening/closing details. Browsing-context implementation is deferred.
- Validate social privacy, activity grouping, recommendations and taste scores with real accounts in a later pass. The wider social roadmap remains in [social.md](social.md).
- Revisit friend-avatar meanings and obtain explicit approval before changing the design.
- Revisit empty-row behavior in an upcoming pass: hide confirmed empty rows; show skeletons while loading.
- Finish component-library consolidation last, focusing on duplicated logic rather than file counts.
- Invite-code onboarding now uses existing Jellyfin accounts and waits for the initial user import. Jellyfin account provisioning, richer onboarding and disposable public sharing remain future work.
- Experimental friend video/music synchronization is implemented; synced chat/reaction overlays, books/comics and guest/public sessions remain future work.
- Park the Jellyfin sign-in replacement decision and token-recovery changes for later discussion. Stored tokens currently rejected by Jellyfin need account attention; the login system has not been removed.
- For You next-item prioritisation was explained as the exact next episode, track or resumable item. The user has not selected this pass yet.
