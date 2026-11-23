# Does precomputing every card change its match?

Fresh on-demand and fully materialized catalogue scores agreed for all **8,450** canonical movies and shows in the private replay. This includes 72 titles for which neither method had enough evidence to display a score. Both paths used Coast’s scorer and a per-medium reference rebuilt from the frozen full-history capture. One path scored the complete catalogue once. The other independently deserialized that reference for batches of 24, scored cards in reverse order, and checked each result by canonical ID. This exercise measures integer score and abstention parity. It uses in-memory changes, with no database writes or network access. [Replay source](materialized-replay.ts)

| Change in one medium | Movies | Shows |
| --- | ---: | ---: |
| Scored catalogue roots, including abstentions | 4,892 | 3,558 |
| Same inputs, score or abstention disagreed | 0 | 0 |
| One prior direct rating changed to two stars | From 5 | From 4½ |
| Previously stored integer disagreed after refitting | 894 | 633 |
| Integer moved by two points or more | 29 | 21 |
| Moved across the 80% card threshold | 84 | 20 |
| Largest individual movement | 5 points | 4 points |
| Recomputed materialization disagreed with fresh cards | 0 | 0 |

The changed rating in each medium was the first by seeded hash of canonical ID among direct, high ratings with no child-credit observations. Other user evidence stayed fixed. About 18% of stored integers changed after refitting, mostly by one point. Changes went in both directions across the catalogue. A full-reference update can move scores for titles that were never themselves edited.

We also removed genres and tags from 24 randomly hash-selected unfamiliar movies and 24 unfamiliar shows that had both fields, with the personal reference frozen. Every previously stored score then disagreed. Fifteen movies and 16 shows had too little evidence to score. Among the other 17 titles, moves reached 22 points for movies and 26 points for shows. Removing all feature fields made all 48 titles abstain. Untouched titles kept their original values and recomputing the materialization produced zero disagreements. These deliberately large changes test the invalidation boundary. Their frequency in ordinary provider updates was not measured.

## What Coast serves today

The background job publishes the lifetime personal reference and scores for up to 500 qualifying shortlist candidates per medium. The card API batches titles, resolves parent works, reuses published results for eligible roots, and scores cold targets with the private reference and current catalogue features. Episodes, seasons and tracks with specific credits can receive a more precise score. A card score excludes the friends adjustment reserved for explicit admin recalculation. The experiment covers root movies and shows. [Shortlist publication](../../../src/lib/social/taste-shortlist.server.ts) · [Card and inspection paths](../../../src/lib/server/api/profile.server.ts) · [Root and child scoring](../../../src/lib/social/taste-cache.server.ts)

The server verifies the policy and scorer format before serving a warm result, and matches its stored revision to the published reference. A tracking change makes the profile due for a rebuild. Existing readable publications stay available until the worker publishes the next revision. A weekly rebuild picks up metadata-only changes. The current warm lookup has no dependency on a target’s latest feature revision. A metadata change between publications can therefore make a warm card disagree with a freshly computed inspection even within the same viewer revision. The client refreshes subscribed cards when it receives a new publication revision. [Server publication and revision rules](../../../src/lib/social/taste-cache.server.ts) · [Client refresh](../../../src/lib/ui/card-taste-batch.ts)

Keep the existing hybrid as the comparison baseline. For immediate consistency after catalogue updates, key any saved card score against both the published reference and its resolved target features, including relevant parent or child metadata. A mismatch can fall back to the existing batched fresh scorer. The experiment supplies no evidence that materializing more titles improves ranking quality, and it does not measure the cost of either storage strategy.

## Reproduction through the application

A second experiment used an independently created and migrated PostgreSQL database. The regular provider ingest path created five movies, and the test viewer favourited three. The usual background task warmed the other two. The application card and detail handlers initially returned **83** for the target. A second provider ingest on that same canonical movie replaced its genre and cleared its matching cast and tags. The card API still returned **83**, while the detail API withheld its score. The database contained both warm rows and the viewer’s published revision stayed unchanged. Evicting just the changed movie’s warm row made the card and detail both withhold it. The unmodified control stayed warm at 83. The fixture deleted its disposable database on completion. [Database reproduction](materialized-db.ts)

For a correctness-first server fix, give the existing batched card path an option to resolve current features for every requested title and use the published reference, without building inspection details or adding admin-only friend points. This needs no new score table. The regression should call both real handlers before and after reingestion and require identical numeric results or abstentions, while the second movie stays stable. A narrower approach evicts scores in the effective metadata write transaction when covered feature values change. It requires coverage of the other catalogue writers and parent or child dependencies. Both approaches need a separate client refresh signal to update a card that is already visible when its metadata changes. [Card batch and inspection](../../../src/lib/social/taste-cache.server.ts) · [Provider ingestion](../../../src/lib/catalogue/service.server.ts) · [Visible-card cache](../../../src/lib/ui/card-taste-batch.ts)
