# Experimental music and gaming

Administrators can enable **Experimental features** in Settings → Policies. The single system-wide toggle defaults to Off. Enabling it makes music browsing and gaming available to signed-in users; only administrators can save the policy.

When Off, Library hides Music and Games, integration settings hide IGDB, and direct music/game pages and APIs (including artwork, import and play-session writes) return 404. The gate also blocks IGDB configuration and provider transport. Film/TV and Jellyfin connections remain available. Toggling Off preserves music connections, games, playthroughs and sessions.

Changes use the existing database-backed system configuration and apply to subsequent requests without a restart. Saving policies refreshes navigation in the current tab; other tabs refresh with navigation or their normal session polling. No migration or new production dependency is needed.
