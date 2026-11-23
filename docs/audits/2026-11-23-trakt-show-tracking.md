# Trakt show tracking

## Trakt

Coast keeps Paused and Dropped as distinct states. Their shared Trakt value is the Dropped flag. An incoming drop fills an untracked Coast show as Dropped. An existing Coast pause is retained, and switching between Paused and Dropped leaves the shared flag unchanged. Explicitly resuming or restoring a synced show removes the Trakt drop. Imported episode history preserves the show’s tracking status. Watching or tracking an episode directly in Coast keeps the existing resume behavior.

An active show rewatch syncs the exact start date. Start and End rewatch use Trakt’s watched-progress reset, which requires VIP for writes. Neither operation deletes viewing history. Imports retain a previously observed reset if it is absent from the rewatch list but still present in the exact show’s watched progress. Coast uses external IDs and skips grouped anthology roots that lack a single provider identity. A season with a verified standalone Trakt identity can sync as that story.

Both features require independent import or export consent. Enabling export seeds existing show state in one set-based insert. A user edit queues work in the same transaction as the native change. Drop exports are idempotent and require no remote list scan per edit. Imports fetch paged snapshots through the existing durable Trakt stage. Writes use the connected account and worker lease checks before dispatch. Network calls run outside database transactions. Integration tests use controlled provider responses and an isolated PostgreSQL database.
