# Progress and empty shelf follow-up

The shared Shelf renders its guidance, optional link, or caller-provided empty content after a successful empty read. Skeleton cards are reserved for loading. Selected and previously shown feed rows retain the existing height calculation, and untouched empty feed rows keep their existing lazy visibility behavior. Failures keep the existing toast and retry path.

Favourites uses the existing portrait card and primary artwork settings. Continue links the first line to the show and the second line to the episode while retaining the existing episode artwork order. The same metadata projection supplies both links and captions.

On a disposable Coast instance, Chromium reproduced a settled empty preview row with twelve skeletons. After the change, the same preview showed one empty message and zero skeletons. Switching from Empty to Loading to Settled and back exercised each state. The empty row fit at 390px without horizontal overflow. A separate Progress check verified both Continue caption destinations and the Favourites poster and primary artwork. No browser errors were observed.

The card hydration, domain application, For You, and home data PostgreSQL suites passed all 51 tests. These fixtures do not measure production latency.

Tabbed Progress requests a nonempty-segment summary with the initial page, and again when the owner, media category, feature scope, or tracking/social revision changes. Paging and changes to Available or media type reuse the settled summary. The summary uses the existing eligibility and viewer checks at the category level so reversible per-tab filters cannot remove access to their own controls.

Continue and Next share the same episode, rewatch, and sequence inputs for summary and selected page. Alternatives use existence checks rather than hydrating any extra pages. Saved membership reuses the existing list predicates. Legacy profile history starts with the owner’s tracked movies/episodes or dropped items before using its existing completion checks. The mixed profile summary reuses its existing personal-history projection. A summary with no eligible tabs returns before card hydration.

Chromium verified that a Favourites-only account opens that tab on For You, with the empty tabs absent. Applying Available kept Favourites reachable and showed its empty result. Opening the expanded page with Continue selected replaced the URL with Favourites. An all-empty account omitted the For You Progress row and kept the expanded Progress page and its empty message. The updated For You and profile PostgreSQL suites passed all 42 tests, including private visibility, queued and paused fallback, Finished, and Reading.
