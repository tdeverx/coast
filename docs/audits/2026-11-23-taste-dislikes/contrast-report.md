# Can a user's disliked shows outweigh similar favourites?

Two controls compared whole previously rated titles, conditioning on positive examples that shared the same content features. Each fitted its rejection threshold on separate families inside the outer training set. Holding out each target's own history preserved the original 32 cohorts. [Registered methods](contrast-protocol.md)

| Show holdout | Disliked / liked targets | Neighbours, dislikes recovered / liked wrongly red | Classifier, dislikes recovered / liked wrongly red | Both controls must agree |
| --- | ---: | ---: | ---: | ---: |
| Whole titles | 33 / 287 | 0 / 0 | 0 / 1 | 0 / 0 |
| Franchises | 33 / 287 | 0 / 0 | 0 / 1 | 0 / 0 |
| Alternate franchise assignment | 33 / 287 | 2 / 1 | 2 / 0 | 0 / 0 |
| Earlier rating dates only | 7 / 128 | 1 / 0 | 2 / 1 | 0 / 0 |

Here “disliked” means a verified rating of 2½ stars or less, “liked” means at least four, and red means below 50. The two standard show splits are the same effective grouping on this capture. The remaining cohorts cover masked movie and show ratings and sparse groups across seeds. Every film, zero-rating and sparse-rating prediction was identical to its paired graded score.

**The favourite check considered individual titles.** Every five-star title retained exactly its paired score in all 32 cohorts. The shared whole-title split kept all 60 green five-star movies and all 51 green five-star shows. The neighbour control moved one 4½-star show from 71 to 46 in the alternate split. Even though it had already been outside green, turning it red is a real error. The classifier never lowered a 4½- or five-star title, but it moved the same four-star show from 64 to 49 on the primary split and from 58 to 48 on rating dates. Across all 32 cohorts both controls left the weak and five-star green counts unchanged.

**The strongest apparent successes involved different titles.** In the alternate show split, the neighbour control recognised two disliked shows (74 to 45 and 60 to 46). The classifier recognised two others (both 62 to 46). On later rating dates, the neighbour control moved one disliked show from 76 to 48 and a 3½-star show from 60 to 48. The classifier recognised two previously unseen dislikes while also moving the four-star counterexample below neutral. The owner-only change ledger retains the paired titles.

For 33 held-out disliked shows, case contrast improved their mean score from 69.09 to 67.79 on the alternate split and left the primary split at 69.55. The classifier gave 68.12 and 69.55 respectively. No movie cohort supplied enough independently validated evidence to lower an individual title. With seven disliked films and 326 liked films in the whole-title test, one coincidentally strong negative neighbour is easy to find.

**Agreement follow-up.** After inspecting the two controls individually, we intersected their previously written per-target predictions. Both had to lower the same title below neutral in the same fold; the higher of the two scores would win. There were zero such titles across all 32 cohorts. Consequently this follow-up retains every favourite and recovers zero dislikes. Both controls consumed the same descriptive data and provide no independent corroboration beyond their different learning methods.

Keep the ordinary and private scorers unchanged by these controls. They do find some dislikes below neutral, but neither demonstrates an improvement across partitions without damaging clearly liked titles. The lower region remains a separate release requirement alongside ordinary ranking. Reading hidden labels after a test cannot justify an exception for a specific title.

## Reproduce

Use the same private canonical capture, verified rating dates, verified credits, independent catalogue counts and graded predictions as the original replay. NumPy is the same offline analysis dependency used by preceding studies. No runtime package or database update is required.

```sh
COAST_CONTRAST_PRIVATE_CHANGES="$private/new-private-changes.json" \
  python3 contrast.py "$capture" "$dates" "$metadata" "$catalogue" "$graded" > "$private/new-contrasts.json"
python3 contrast-consensus.py "$graded" "$private/new-private-changes.json" > "$private/new-agreement.json"
```

The optional private change ledger includes target identifiers and is created exclusively with owner-only permissions. The [aggregate results](contrast-results.json) record both arms' pair rankings, changed ratings and paired favourite checks. A separate dense-matrix implementation of the token kernel reproduced all 64 control results, including every score change.
