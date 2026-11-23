# Selected rules for browsing the copied catalogue

The catalogue publisher starts with the same calibrated personal percentage used in the replay. It calculates the creative-team correction, the personalised TMDB check, and the two similarity-capped follow-ups in their retained order. It never applies the softer display experiment.

The [publisher](selected_catalogue.py) uses independently predicted donor scores, direct personal ratings, stable provider credits, genres, keywords, and the same local synopsis encoder as the offline study. Each comparison is within a medium. Titles in the target's family cannot supply their own evidence. A missing cast credit, audience vote or synopsis gives the associated rule less evidence. The personal score can still stand.

The copied database supplies catalogue roots and target metadata. The experimental fit uses the original evaluation snapshot for the user's history. For an unseen target, the personal model uses all of that permitted history. For a title the viewer has tracked, the publisher requires a native forecast fitted with the target removed. A donor residual also needs a fit independent of the target's observed family. When such a residual is unavailable, the corresponding comparison abstains.

The [parity check](verify_selected_catalogue.py) reruns the catalogue code against the original 870 whole-title holdouts using their original masks and double-exclusion donor fits. The published percentage matched all 870 selected forecasts. Compared with the calibrated personal score, the exact-team rule changed four, the personalised audience rule changed five, and the story, credit and plot rule changed one. The margin for the qualifying person and studio comparison was zero.

Run each script with `--help` for its inputs. The viewer-specific input and output files are private and contain account history. The publisher opens a new output with owner-only permissions and requires the verified rating snapshot and replay hashes before reusing known-title predictions. For new or changed synopses, provide the source description files and the original local encoder. Its CPU work happens during publication. Card reads need only the prepared result for the current user, revision and catalogue root.

## Portable scorer verification

The TypeScript evaluator accepts a normalised work and a prepared per-viewer, per-medium donor reference. It evaluates arbitrary works using their current evidence. It has no catalogue-score file dependency. The [rule comparison](verify-selected-catalogue.ts) checks the rule identity and the displayed percentage independently. The [native comparison](verify-selected-native.ts) checks both ordinary personal forecasts and the alternative estimate used by the TMDB check.

| Scorable set | Cases | Selected matches with compatible synopsis vectors | Selected matches without synopsis vectors |
| --- | ---: | ---: | ---: |
| Directly rated movie and show holdouts | 870 | 870 | 869 |
| Other tracked and previously unseen catalogue titles | 10,837 | 10,837 | 10,834 |
| Total | 11,707 | 11,707 | 11,703 |

The four differences without vectors were withheld story and credit penalties. All eight original red dislikes retained their scores. Every one of the 10,377 scorable, previously unseen titles also reproduced its original native and alternative personal forecasts. These are implementation parity checks on one account. They do not imply equivalent accuracy for an arbitrary account.

The synopsis gate requires compatible semantic vectors. Coast's standard source metadata currently provides text. The production scorer abstains on this particular rule when a compatible vector is absent. A separately tested word-frequency substitute changed the identity of the nearest favourite in a decisive case, so it cannot stand in for the validated meaning of similarity.

## Final dynamic card replay

The copied catalogue contained 11,750 current encoded descriptions. The incremental export was empty after the import. The published movie and show references contained verified vectors for all 871 rated comparison titles. We read every movie and show root through the normal server function in batches of up to 72. This exercised both the compact stored vectors and the rule that requires independent story and credit evidence. [Production comparison](dev-personal-comparison.ts) · [Publication and serving checks](dev-personal-publish.ts)

| Targets | Total | Scored | Same displayed integer as the frozen study | Median absolute difference | Runtime below 50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| No tracking or rating | 10,500 | 10,377 | 10,281 | 0 points | 10 |
| Other tracked titles | 461 | 460 | 137 | 1 point | 0 |
| Directly rated holdouts | 870 | 870 | 233 | 1 point | 9 |

The two versions withheld a score on exactly the same 124 roots. They identified the same ten previously untouched titles below 50. The mean absolute difference across the 10,377 scored untouched titles was 0.0103 points. On tracked titles the production model holds out a group of families together, so it trains on less history than an individual whole-title research fit. One tracked title without a direct rating scored 77 in production and 47 in the study because it lacked sufficient comparisons for the personalised audience check.

All eight previously identified dislikes remained below 50. These accounted for eight of 40 ratings of 2½ stars or less, including eight of 33 shows and zero of seven films. None of the 610 four- or five-star titles fell below 50. The ninth sub-50 rated holdout had a middling rating. Testing used a single account with substantially more positive than negative ratings.

Among the 11,707 scored titles, 11,684 kept their personal estimate. Exact creative teams adjusted eight, the personalised audience check adjusted 11, and story plus credits adjusted four. All four story adjustments reproduced the research percentages, including three untouched shows and one rated show. Their scores moved from 63 to 60, 77 to 72, 69 to 68 and 79 to 77. The person and company rule produced no displayed adjustment in this account.

To reproduce, run the linked comparison on an explicitly named loopback copy with the viewer name, private frozen catalogue, selected research publication and a new private output path. Join that output by root ID to the captured shelf IDs. The first ten positions across three visits again yielded 151 untouched movies with a median of 81 and 47 untouched shows with a median of 84. All 198 remained between 70 and 89. [Shelf sampling and catalogue comparison](browse-dispersion.md)

### Card request timings

We timed the authenticated HTTP card-score endpoint on the local development copy, with 24 IDs per request. Each group returned all 24 scores consistently across seven reads. The first viewport request after restarting the server took 622 ms. These badges load asynchronously after the underlying card data. The measurements cover the score request and response decoding only.

| Group of 24 | Median of six warm requests |
| --- | ---: |
| Sampled For You viewport | 49.5 ms |
| Untouched titles, 12 movies and 12 shows | 41.05 ms |
| Tracked titles spanning all ten movie and show holdout groups | 44.2 ms |

The last group previously took 318.1 ms warm. Packing the stored synopsis vectors lets those comparison references fit within the existing cache limit. The before and after measurements use the same 24 title IDs and the same signed-in route. They are small sequential samples from one account on a shared development machine. They establish neither production percentiles nor a whole-page loading improvement.
