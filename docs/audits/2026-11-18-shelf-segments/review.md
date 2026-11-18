# Requests, Activity and profile segments

Requests reuse the shelf preview and expanded-grid loader. Accepted and Processing use separate states in the existing server-side predicate for counting and paging. The media-type filter and its reset preserve the active status.

Activity requests the selected enabled medium and defaults to the viewer and accepted friends. Switching medium cancels the old cursor, retains compatible filters and clears incompatible ones. An empty selection keeps its controls available without a second request for all media.

Profiles use the shared progress shelf as Watching. Later replaces the separate saved-title shelf and uses collection visibility, including when the viewer cannot see progress. The visibility projection checks both permissions across enabled tracking media. Segment discovery checks for visible Later entries without hydrating cards or checking a profile Favourites segment. The active segment keeps the existing lazy preview and bounded hydration.

Local Svelte checks and focused source tests cover the controls, scope, cancellation, reset and expanded destinations. Hosted browser behavior and PostgreSQL integration with this patch remain unverified.
