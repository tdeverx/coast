# Evaluating the sealed audience predictions

Compare the prediction made before a movie or show received its first verified personal rating. The four columns use the same viewer, titles and rating outcomes, with maximum audience adjustments of zero, two, four or eight points.

Run the evaluator with private exports from the same account. It reads the files and prints aggregate results for movies and shows.

```sh
python3 -B prospective-outcomes.py VERIFIED_RATINGS FIRST_LEDGER SECOND_LEDGER --also-ratings EARLIER_RATING_EXPORT
```

One ledger and one rating export suffice. Additional rounds and prior event exports are optional. Preserve earlier rating exports when the provider can replace a rating with its latest value. Each source file accepts either an array of direct rating events or an envelope containing the same pseudonymous `accountKey` as the seal and a `ratings` array. A bare array relies on the caller to supply the correct user's records.

Each event supplies the canonical Coast `id`, `medium` (movie or show), direct half-star `stars` and original timezone-aware rating time `at`. Personal imports should use the provider's original rating timestamp. An import arrival, a file modification, or a row's most recent edit cannot establish when the user first rated the title. Pass unknown times as null to conservatively exclude that work. Keep earlier direct events even if a later edit changed the rating.

The evaluator matches independently salted rounds before choosing the earliest available forecast for that work. A later, more confident prediction cannot replace an earlier abstention. The label is the earliest verified event strictly after sealing. A verified pre-seal rating, an unknown timestamp, conflicting first values or conflicting simultaneous first forecasts excludes that work. Ratings dated in the future remain ineligible. Multiple rounds must share an account and scoring policy. A conflicting private input fails without printing personal labels.

## Collecting verified Trakt outcomes

Set `DATABASE_URL` to the local `taste_card_benchmark` Coast copy and `COAST_DATA_DIR` to that copy's private data directory with its existing credential key. Use the usual repository Bun runtime. The configured Trakt connection must have its ratings import enabled and a valid access token. This read-only collector checks the authenticated remote account and only allows GET requests for profile identity, last activity and paginated ratings. If its copied token expires, take fresh authorised credentials from the copy workflow. It never refreshes or rotates a provider token.

```sh
bun docs/audits/2026-11-23-personal-credit-nudge/prospective-trakt.ts VIEWER_NAME PRIVATE_LEDGER NEW_PRIVATE_EXPORT
python3 -B docs/audits/2026-11-23-personal-credit-nudge/prospective-outcomes.py NEW_PRIVATE_EXPORT PRIVATE_LEDGER --also-ratings PREVIOUS_PRIVATE_EXPORT
```

Each export is owner-only and requires a new filename. It uses provider IDs against the catalogue, including titles without any local rating. Episode and anthology-season ratings are excluded from whole-show outcomes. Unknown dates and conflicting identity matches produce no eligible labels. A changed account identity or changes to Trakt activity during pagination abort the export. Trakt supplies its currently recorded ratings and their original provider timestamps. If a rating is revised before the first export has captured it, an earlier value may be unavailable. Preserve successive exports to keep observations already captured. Coast-native ratings need independently verified first-event evidence.

Each medium reports eligible first ratings, paired predictions and the subset with usable TMDB votes at prediction time. An unavailable public rating preserves the frozen baseline across all four arms. Assess changes in point error and the ordering of titles rated differently, plus the number of five-star favourites pushed below 80 and personal favourites whose rating exceeded the public average by a full star. Pair counts describe comparisons among the observed works. An empty or one-sided cohort reports null for metrics that cannot be computed.

For each weight, the report also counts how often a changed forecast ended up closer to the eventual rating, further away, or equally far. It reports average improvement both across all eligible ratings and among just the predictions the nudge actually changed.
