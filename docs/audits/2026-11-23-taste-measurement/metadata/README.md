# Can better title metadata separate the false matches?

The strongest finding is a missing television credit. Coast already stores verified TMDB show creators. Its taste extractor skips that role. Identifying a creator helped distinguish some titles that share genres, but the average improvement was small and inconsistent across time. Plot descriptions and catalogue completeness each produced misleadingly promising results on some measures.

## What the catalogue can tell us

- The history builder and batch card scorer both call `workTasteFeatures`. All 664 movie and 430 show roots available on both sides of this frozen replay had identical feature dictionaries. The close scores therefore do not come from mismatched feature extraction on these roots. [History](../../../../src/lib/social/taste-history.server.ts) · [Cards](../../../../src/lib/social/taste-cache.server.ts)
- Director and writer identities were present on 444 and 443 of 444 rated movies. Those counts fell to 18 and 17 of 429 rated shows. A verified creator was already stored for 406 of those shows. TMDB's separate `created_by` field survives ingestion as the role `Creator`, then falls through the taste role map. A future role should retain its own identity. [TMDB ingestion](../../../../src/lib/providers/tmdb/adapter.server.ts) · [Taste roles](../../../../src/lib/providers/tmdb/taste-credits.ts)
- All 873 rated titles had a local synopsis. Median length was 43 words for movies and 39 for shows. Movie and show synopsis resolution used a nonempty manual override first, then TMDB, canonical title metadata, Trakt and Jellyfin.

## What predicted the held-out ratings?

Ordering is the percentage of within-fold comparisons where a title rated at least four stars scores above one rated three stars or less. Ties earn half credit. Work folds hold back all interactions belonging to that title. Their native reference retains Coast’s existing attenuation when a low personal rating agrees with broad public reception. None of the added content signals receives an audience score or another account’s data. Forward tests train only on explicit ratings already recorded before January 1 of the indicated year. The catalogue snapshot is current, so historic metadata availability remains unknown. The forward inputs contain no viewing, selection, saved, child-credit, audience-rating or return signals. Two ratings that could not be verified as direct current show ratings were excluded from the forward cohorts.

| Test | Existing ordering | Synopsis model¹ | Including creator² |
| --- | ---: | ---: | ---: |
| Movies, work folds | 75.96% | 59.58% | — |
| Movies, franchise folds | 76.54% | 58.79% | — |
| Shows, work folds | 79.32% | 74.59% | 79.61% |
| Movies, rated during 2022–23 (49) | 76.79% | 57.50% | — |
| Movies, rated during 2024–26 (33) | 93.75% | 92.86% | — |
| Shows, rated during 2022–23 (88) | 71.91% | 63.38% | 72.79% |
| Shows, rated during 2024–26 (13) | 75.00% | 65.00% | 70.00% |


## The catalogue completeness trap

A deliberately content-blind control sees only whether runtime and certification are present and how many credits, tags and studios exist. It sees no names or tag identities. Its five-fold ordering reached 71.72% for movies and 84.34% for shows. The catalogue contains a TMDB snapshot for 443 of 444 rated films and all 429 rated shows, compared with only 1,808 of 4,228 and 1,091 of 3,128 unseen controls. Similarly, 22 of 59 five-star shows had canonical runtime, versus zero of 33 shows at 2½ stars or below. This association could reflect which titles received enrichment as well as the viewer's behaviour. Runtime is not a current taste feature.

Matching comparisons within the same fold on available runtime, available certification and six-tag count bands changes the picture. Coverage-only movie ordering drops from 71.72% to 51.56% across 128 comparable pairs. The real score reaches 66.41% on those pairs. Shows retain a coverage association even after matching (72.89% versus the real score's 76.37% across 402 pairs). The other two coverage counts still vary within each matched group. A separate check that stripped target certification entirely gave almost the same ordinary ordering, while capping target features reduced existing movie/show ordering from 75.96%/79.32% to 73.25%/77.85%. Keep catalogue breadth out of preference labels, and report coverage alongside future evaluations.

We also retrained each work-fold reference after removing whole feature families on both sides and turning **all public rating inputs off**. Each comparison uses precisely the same scorable titles under its two policies.

| Removed from training and target | Movies, with / without personal ratings | Shows, with / without personal ratings |
| --- | --- | --- |
| Nothing | 75.93% / 64.73% | 79.29% / 66.79% |
| Certification | 76.42% / 62.14% | 79.42% / 67.24% |
| Cast and individual crew | 67.08% / 51.11% | 78.39% / 65.70% |
| Network and studio | 76.11% / 62.74% | 79.72% / 66.18% |
| Era, country and language | 75.90% / 62.38% | 79.28% / 67.28% |

The rated show era/region comparison loses one scorable title, giving it a paired baseline of 78.95%. Genres, tags and themes are especially consequential for coverage. Removing them together made just 152 shows with ratings and 176 without ratings scorable, from 428. Their ordering fell to 50.33% and 49.85% from paired baselines of 77.90% and 62.00%. Movies lost 110 and 112 scorable titles respectively, which makes the remaining subset especially selective. Movie cast and crew on the other hand retain all 444 scorable titles and removing them harms ordering both with and without ratings. There is no basis here for treating one fixed feature-family hierarchy as correct for every medium.

For additional editorial signals, consistently identified properties such as tone, themes and subgenres are a better next experiment than accepting raw synopsis similarity. Explanatory movie-tag experiments and the Tag Genome provide precedents for testing *specific, relevant* features. They do not establish a gain for this account. [Tagsplanations](https://files.grouplens.org/papers/vig-iui2009-tagsplanations.pdf) · [Navigating the Tag Genome](https://files.grouplens.org/papers/navigating-the-tag-genome.pdf)

## Reproduction

Keep the two-medium frozen `captureTaste` output in a private directory as `card-spread-history.json` alongside verified direct rating dates. Use the shared [ordinal fold generator](../ordinal-inputs.ts) to create `ordinal-inputs.json` there. The commands below assume that directory is in `PRIVATE`, that an existing project-compatible Bun is on PATH, and that the working directory is this folder.

```sh
bun ../ordinal-inputs.ts "$PRIVATE/card-spread-history.json" "$PRIVATE/rated-dates.json" "$PRIVATE/ordinal-inputs.json"
bun capture.ts "$PRIVATE/card-spread-history.json" "$PRIVATE/metadata.json"
python encode.py "$PRIVATE/metadata.json" "$PRIVATE/card-spread-history.json" "$PRIVATE/model.onnx" "$PRIVATE/vocab.txt" "$PRIVATE"
python research.py "$PRIVATE"
python dated.py "$PRIVATE"
python coverage.py "$PRIVATE"
bun creators.ts "$PRIVATE/card-spread-history.json" "$PRIVATE/metadata.json" "$PRIVATE/rated-dates.json" "$PRIVATE/creator-scores.json"
bun mask.ts "$PRIVATE/card-spread-history.json" "$PRIVATE/masked-scores.json"
bun families.ts "$PRIVATE/card-spread-history.json" "$PRIVATE/family-scores.json"
python families.py "$PRIVATE/family-scores.json"
```

Only `capture.ts` needs the copied database's `DATABASE_URL`. It enforces a loopback host and a read-only transaction. Computation uses local NumPy and, for embedding generation only, ONNX Runtime with the official `onnx/model_qint8_arm64.onnx` and `vocab.txt` pinned to revision `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`. No raw titles, histories, ratings or embeddings are distributed with this audit. All outcomes above come from one account. [Pinned weights](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/tree/1110a243fdf4706b3f48f1d95db1a4f5529b4d41)
