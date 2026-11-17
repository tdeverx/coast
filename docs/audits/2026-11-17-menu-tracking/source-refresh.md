# Media menu tracking actions

Hiding a work from Progress drops it through the existing tracking command. This path no longer reads, deletes or restores rewatch boundaries. Undo retains the queue snapshot and checks that its drop is still current. The current action feedback reflects the Progress change.

The on-open menu read includes the viewer's current check-in ID for the exact movie or episode. The lookup matches the existing partial index for one active check-in per user and runs within the metadata query. The lookup is omitted for other media and when Presence is disabled. Cancel and End rewatch reuse the existing mutations.

The local database suites covered Watching, Next, Dropped, exact rewatch position and history after restoring, stale Undo after a new rewatch, and check-in expiry, ownership and cancellation. Svelte diagnostics passed. Earlier hosted observations remain tied to their recorded source and data. This change has local functional verification and no hosted measurements.
