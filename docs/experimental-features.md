# Experimental features

Administrators manage independent feature switches in Settings → Policies → Experimental features. All experiments default to Off. Music, Gaming and Parties each have their own switch; existing installations migrate the previous shared switch to all three without changing its enabled state.

- **Music:** album/track browsing, listen tracking, audio playback and Jellyfin music imports.
- **Gaming:** game discovery, playthroughs/sessions, IGDB and Steam integrations and Steam jobs.
- **Parties:** synced video/audio sessions and invitations. Video parties work independently of Music and Gaming; music playback also requires Music.
- **Dynamic For You:** personalised horizontal rows loaded as you scroll.
- **Planning & calendar:** scheduled plans, reminders and upcoming releases.
- **Personalised recommendations:** suggestions based on personal activity and shared genres.
- **Media detail overlay:** the existing hero and details over the current page.

Disabled media are hidden from rows, search, social activity and public API results before pagination. Direct pages and APIs are gated independently. Disabling a feature preserves saved relationships, history, games, connections and sessions. Film/TV and ordinary Jellyfin connections remain available.

Policies use the existing database-backed configuration and apply to subsequent requests without a restart. Saving refreshes the current tab; other tabs update through navigation or session polling. Site access, registration and disposable playback links live separately under Access & registration.
