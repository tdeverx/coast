# Does public reception corroborate a personal dislike prediction?

This test replays the two personal content classifiers from the [dislike audit](../2026-11-23-taste-dislikes/contrast-report.md). It fixes the following rules before examining which predictions survive. The classifiers already proposed particular red scores. TMDB can veto a proposal and restore the original score. It cannot introduce a new red score.

- Use the saved TMDB user score on its original ten-point scale. Within each medium, estimate the usual audience score from the median of catalogue titles having at least 20 votes. Shrink each eligible score toward this median with 50 prior votes. Use the bottom quartile of these adjusted scores as the poor-reception band. Missing scores and counts below 20 supply no corroboration. The catalogue reference uses no personal ratings.
- First measure using the reception band alone. Then require that the viewer usually rates poorly received titles lower in the same context. Build that context from up to 48 independently rated franchises sharing genres or tags, ranked by the average of genre and tag Jaccard similarity. The closest rated representative of each family counts once. Exclude the target’s family, held-out ratings and later dates. Break similarity ties by canonical ID.
- For the contextual test, require at least eight families in the poor-reception band and eight outside, and two directly disliked families in the poor band. Compare the fraction rated at most three stars in each group. Require the difference to exceed 1.28 posterior standard deviations using independent Beta(1,1) priors. This approximate one-sided test describes the training data only.
- Preserve every prior score and abstention when there is no qualified proposal. Report the individual favourites affected, incorrect red scores and recovered dislikes on the original whole-title, franchise, date and masked-rating replays. Using a current TMDB snapshot on historical titles makes this a retrospective diagnostic.

## Results

The two personal classifiers proposed 16 changes across the 32 panels. Neither audience check produced a new true red score on the principal whole-title holdout. A veto can only retain or reverse an existing proposal, and the personal classifiers had already missed all 40 dislikes on that split. Both checks reversed the four-star show's false red on that split.

| Show replay and personal classifier | Personal alone | Also requires poor reception | Also requires local agreement |
| --- | --- | --- | --- |
| Alternate franchises, nearest titles | 2 dislikes, 1 middling, 1 liked | 0 changes | 0 changes |
| Alternate franchises, linear classifier | 2 dislikes, 1 middling | 1 dislike, 1 middling | 1 dislike, 1 middling |
| Earlier rating dates, nearest titles | 1 dislike, 1 middling | 1 dislike | 0 changes |
| Earlier rating dates, linear classifier | 2 dislikes, 2 middling, 1 liked | 2 dislikes, 2 middling | 2 dislikes, 2 middling |

Each count represents a title that crossed below 50 in that panel. Middling means three or 3½ stars. The stricter checks preserved every five-star score and reversed all four-plus false reds for these classifiers. They still penalised some middling shows. The one dislike preserved by the simple audience veto on the dated nearest-title test failed the local agreement check. Its audience score provided a clue, but the viewer’s earlier ratings in similar contexts supplied insufficient corroboration.

The poor-reception band itself contained only 3 of 7 disliked films and 14 of 33 disliked shows. It also contained 45 liked films and 52 liked shows, including eight five-star favourites in total. These counts include the vote minimum and shrinkage specified above. A descriptive crowd cutoff and personalised prediction answer different questions.

Reproduce using the original frozen data from the [contrast experiment](../2026-11-23-taste-dislikes/contrast-report.md). The optional `COAST_AUDIENCE_CORROBORATION_PRIVATE` output contains individual title IDs and must stay private.

```sh
python3 corroboration.py "$capture" "$tmdb_metadata" "$verified_rating_dates" "$native_graded_replay" "$previous_personal_classifier_changes"
```
