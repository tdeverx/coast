# Trakt history export

A history export verifies a movie or episode by its saved Trakt, TMDB, TVDB or IMDb IDs. Coast skips missing and ambiguous mappings, disagreements between IDs and Trakt IDs already assigned to another Coast item. Exact imported Trakt history IDs still support selective removal of individual watches. Other outbound categories keep their existing matching rules.

The job uses the existing provider transport and makes at most one lookup per saved ID. One history request with a one-record limit determines whether the title is watched. Additions use a second request for the exact watch timestamp to preserve retry safety. The verified Trakt ID is used for both reads and the write. The number of requests no longer grows with account history. No cache or background scan is added.

The adapter fixtures cover each external ID provider, wrong media kinds, ambiguous and conflicting results. PostgreSQL fixtures cover scoped history requests, skipped jobs, conflicting local ownership, import and anthology regressions, and selective removal. The HTTP fixture verifies that retrying after a lost write response does not add a second play. These checks cover the local contract and request counts. Live Trakt delivery, latency and rate limits were outside this verification.
