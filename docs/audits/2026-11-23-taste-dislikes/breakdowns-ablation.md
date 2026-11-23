# Removing the two sources of upward pressure

Two diagnostic changes were specified before inspecting their results. Both use the same fitted profiles, held-out works and previously learned display map as the private candidate.

1. **Remove a more positive signed score.** When the signed affinity component would raise the personal component, substitute the personal score. Retain the signed component if it lowers the score.
2. **Remove the favourable rating intercept on negative evidence.** Score the title's fitted ordinal terms again with the same feature memberships and all coefficients zero. When its actual ordinal terms reduce the prediction, subtract the positive starting uplift from the rating component. Route its adjusted score through the original behaviour mixture, personal display scale, signed component and final grading.

All unchanged native predictions matched the frozen receipt. Tested separately, both changes produced zero below-neutral predictions among disliked films and shows in every one of the 32 cohorts. Neither produced a new below-neutral prediction for any work rated at least four stars.

| Full-rating tests | Scorable dislikes / favourites | Baseline green dislikes / green favourites | Remove a more positive signed score | Remove favourable intercept |
| --- | ---: | ---: | ---: | ---: |
| Movie, whole title | 7 / 66 | 3 / 60 | 3 / 55 | 3 / 55 |
| Movie, franchise | 7 / 66 | 3 / 57 | 3 / 54 | 3 / 53 |
| Movie, alternate franchises | 7 / 66 | 3 / 56 | 3 / 51 | 3 / 47 |
| Movie, later ratings | 7 / 35 | 4 / 29 | 1 / 14 | 4 / 24 |
| Show, whole title and standard franchise | 33 / 59 | 4 / 51 | 3 / 45 | 4 / 51 |
| Show, alternate franchises | 33 / 59 | 3 / 51 | 1 / 44 | 3 / 51 |
| Show, later ratings | 7 / 24 | 2 / 16 | 1 / 13 | 2 / 16 |

On the whole-title movie test, dropping the more positive signed component lowered 34 five-star predictions; intercept centering lowered 11. On shows the figures were 33 and three. Removing the signed component on later movies reduced liked-versus-weak ordering from 85.32% to 78.44%; centering the intercept reduced it to 82.11%. In the 50-rating movie cohorts, intercept centering lost between seven and ten green favourites without identifying any disliked movie as below neutral. Neither change affected rating-free predictions.

As a separate interaction test, center the intercept first and remove the signed component whenever it would lift the resulting forecast. Together the removals correctly put 17 of 33 disliked shows below neutral in the whole-title test. They also put 20 of 287 liked shows below neutral and moved six five-star predictions out of green. The alternate franchise test caught 15 dislikes and put 21 liked shows below neutral. On later rating days the combination found three of seven disliked shows, turned 15 of 128 liked shows red and lost three green five-star favourites. On whole movies it found zero of seven dislikes, put four of 326 liked movies below neutral and lost six green favourites. Both rating-derived safeguards can jointly explain the absence of red show predictions; removing both gives a poor decision rule.

These component removals can explain overly generous scores, but neither separates dislikes sufficiently from favourites. A favourable component for a weak candidate can also contain valid genre or credit information for a favourite. **Keep both ablations out of the scorer.** These are component-isolation results; an independently trained classifier or a newly fitted scale is a different experiment.

[Complete cohort counts and ranking metrics](breakdowns-ablation-results.json) · [Native replay](breakdowns-ablation.ts)

```sh
bun docs/audits/2026-11-23-taste-dislikes/breakdowns-ablation.ts CAPTURE VERIFIED_CREDITS INDEPENDENT_CATALOGUE GRADED_HOLDOUTS VERIFIED_DATES
```
