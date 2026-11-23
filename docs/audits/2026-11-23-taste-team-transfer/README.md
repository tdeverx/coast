# Where does creative-team history help?

On the original account, the clearest personal negative signal still comes from two pairs of similar shows by identical creators. It recovered four of 40 dislikes on the whole-title comparison and one of 14 using strictly earlier rating days. Widening eligibility failed to recover an additional dislike. Across independent movie viewers, evidence about an exact creative team identified some real dislikes, but changing the numeric fit generally introduced substantial errors. Keep this as evidence for why a prediction is plausible. The displayed model continues to use its existing scoring policy. [Original experiment](../2026-11-23-personal-dislike-signals/README.md)

## The original viewer

- Carrying negative feedback across a change of creative team identified no further dislikes. On one franchise assignment, two-star feedback about another show from one returning creator pushed a 4½-star favourite from 71 to 30. That mistake could not occur in the earlier-date replay. A check on recurrent episode writers supplied no comparable outside-family title for any of the 33 disliked shows; there were three comparable liked targets. [Returning leads and writers](partial.md) · [Episode writer coverage](partial-episodes.md)
- Positive feedback was informative about some already-green films. Fourteen boosted films were all personally rated four stars or higher, averaging 4.54 stars against 4.29 for similar, similarly scored comparison films. The boost recovered none of the 14 five-star titles missed by green. It also raised a three-star show to 100. Some seemingly separate shows shared a fictional universe. [Positive and negative transfer](positive.md)
- Moving a filmmaker's opinion between film and TV found no transfer opportunities for the original 40 dislikes. Allowing a partial team raised an already-green 4½-star show. Sparse movie tests sent two 3½-star films to 100. There were 47 personal episode ratings and one season rating; neither the unrated parents nor the two negative child ratings supplied another qualifying negative donor. [Cross-format results](cross-format.md) · [Child ratings](child-coverage.md)

## Other viewers

The frozen copied server had one profile with adequate movie/show history, so the external tests used separately evaluated anonymous viewers from the official MovieLens datasets. Each viewer's scorer was fitted exclusively to that person's earlier ratings. Directors, genres and movie identifiers supplied descriptive data; no audience averages were used. Current credit metadata makes this an external retrospective film test. The TV overlap provided no eligible same-creator pairs. [External protocol and results](external.md) · [External TV coverage](external-tv.md) · [MovieLens 25M](https://grouplens.org/datasets/movielens/25m/)

| Chronological movie test | Newly red dislikes | Newly red middle ratings | Newly red four-plus ratings |
| --- | ---: | ---: | ---: |
| Exact team, similar genre, first 25M viewer sample | 23 | 36 | 29 |
| Same rule, disjoint viewer sample | 26 | 52 | 18 |
| Softer correction, same disjoint viewer sample | 18 | 34 | 11 |
| Require past success with two other directors, remaining 38,015 viewers | 6 | 6 | 1 |

The last test required each person to have demonstrated that this clue worked on two other director teams. The rule qualified for just 153 of 4,015,155 held ratings. Of those 153 movies, 104 really were disliked. The full adjustment made the match less accurate overall because the original score already recognised much of the risk. Six newly identified dislikes came at the cost of seven other movies incorrectly crossing below 50. Average absolute error increased from 16.71 to 20.61 points on eligible cases. The smaller adjustment also increased error, to 17.64. [Viewer-specific validation and replication](viewer-validation.md)

## Prospective check on the copied profile

A separate private comparison now records all changed predictions among the previously sealed unseen titles. It reused 4,228 movie and 3,128 series baselines, exact verified leads and independent franchise-held predictions for the viewer's rated donor titles. The original negative TV rule changed three unseen series and zero films. Each of the three crossed below 50. Pair and title identities remain private; existing ledgers were not overwritten. There were zero independently dated new ratings for these forecasts at sealing. Their first subsequent personal rating can be checked against both frozen scores without fitting again or changing a card. [Freezing code](forward-check.py) · [Later-rating evaluator](../2026-11-23-taste-v2/prospective.py)
