# Can a single viewer have several taste profiles?

**Use close matches from the viewer’s own history to explain a score. Keep automatic clustering out of the displayed percentage for now.** An explicitly trained local adjustment found some worthwhile matches, including later Ghibli films. It also lowered ordering for franchise-held-out movies, unrelated shows and the latest show ratings.

## Experiments

All recommendations here use one viewer’s own history and the catalogue’s genre, tag, studio, network and stable credit IDs. Nobody else’s watches, ratings or votes enter the native baseline, feature vectors, fitting or final scores. Personal profiles were built independently inside each training partition. Each feature family has a fixed budget, so a movie with twenty cast members does not receive twenty times the people weight. Explicit ratings supply the opinion. The masked comparison uses the person’s confirmed consumption as positive evidence. This frozen cohort contains no explicit dropped titles and only two repeated movies and six repeated shows, so masked comparisons cannot estimate a trustworthy personal negative prototype.

The first method represents the account with one centroid for its liked titles and one for its weakly rated titles. The second clusters each side into up to three or six coherent interests. A third clusters titles without seeing ratings and then estimates each cluster’s local rating. A fourth compares the target with the person’s four or twelve closest prior titles. A nested variant lets the preceding training folds choose a zero, small or larger correction to the native score, capped at eight percentage points. It can choose local rating groups or nearest titles. No model or mixing strength was selected on a held-out title or a later date.

| Evaluation | Native | Single pair of centroids | 3 positive / 3 negative clusters | 12 nearest personal ratings | Native + nested adjustment |
| --- | ---: | ---: | ---: | ---: | ---: |
| Movies, same work folds | 75.93% | 69.22% | 56.14% | 67.83% | 76.08% |
| Movies, franchise held out | 76.63% | 66.39% | 60.11% | 67.21% | 76.07% |
| Movies, 2022–23 (49) | 76.79% | 77.86% | 57.86% | 83.57% | 81.43% |
| Movies, 2024–26 (33) | 93.75% | 82.14% | 73.21% | 83.93% | 94.64% |
| Shows, same work folds | 79.29% | 77.74% | 67.43% | 76.57% | 79.07% |
| Shows, 2022–23 (88) | 71.91% | 63.82% | 61.47% | 75.59% | 73.53% |
| Shows, 2024–26 (13) | 75.00% | 90.00% | 40.00% | 90.00% | 70.00% |

Percentages measure whether a ≥4-star title outranks a ≤3-star title within the same held-out fold. Forward models use the verified original dates and values of then-known direct ratings. Catalogue facts are today’s snapshot. In the masked work replay, one consumption centroid gave 62.41% for movies and 69.71% for shows, versus native 64.73% and 66.79%. Dividing those same positive examples into three clusters reached only 55.72% and 43.59%.

## What the examples say

- In the work folds, the nested adjustment raised animated-show ordering from 76.58% to 77.22% while science fiction fell from 58.31% to 57.18% and unrelated shows fell from 78.42% to 78.04%. The apparent Ghibli improvement does not establish a general gain from separating interests.

Billsus and Pazzani used nearest previously rated articles to represent several interests in one person’s news history. Topical subprofiles have also been compared with one overall profile in journal recommendation. Their contrasting domains motivated testing both methods directly. Research comparing inferred film-feature preferences against expressly stated preferences also cautions against claiming that a correlation with an actor, director or genre proves the viewer likes that feature. [User modeling for adaptive news access](https://ics.uci.edu/~pazzani/Publications/BillsusA.pdf) · [Topical and temporal content profiles](https://link.springer.com/article/10.1007/s11257-022-09354-7) · [Evaluating explicit and inferred film preferences](https://arxiv.org/abs/1908.11055)

## Could the viewer teach Coast which feature mattered?

In a movie study with 155 qualifying participants, the best tested method inferred people’s self-declared favourites from their favourite films with average cosine similarity of 0.58 for genres, 0.09 for actors and 0.17 for directors. The authors found recurring Marvel cameos raised Stan Lee in inferred profiles even though nobody named him as a favourite actor. A separate seven-week MovieLens trial found 89% of survey respondents liked being able to steer a search with tag critiques. These studies measured agreement with stated preferences and the experience of using search. An improvement in Coast’s future enjoyment predictions would need its own test. [Explicit movie-feature preferences](https://arxiv.org/pdf/1908.11055) · [Movie Tuner field trial](https://files.grouplens.org/papers/tag_genome.pdf)

Coast currently records a rating or endorsement for a title and infers preferences for its features. An affinity’s “explicit samples” count titles with explicit feedback. It cannot tell whether the viewer singled out the studio, a director or a tag. A statement restricted to a particular title, a request for a different mood today and a lasting feature preference would carry different meanings if this were ever tested. [Taste observation model](../../../src/lib/social/taste-training.ts) · [Affinity accumulator](../../../src/lib/social/taste-profile.ts)

A check Coast can run now is to count independent titles **with only one of the two suspected features**, then inspect comparable personal likes and dislikes in those groups. In this snapshot all three rated movies tagged anime also carry the Ghibli studio credit, and all three received at least four stars. Neither feature appears alone on another rated film. The 441 other rated movies cannot tell us which of the two features mattered. Missing tags also limit what Coast can conclude. If the viewer later volunteers an opinion on either feature, preserve its actual scope and time, then compare predictions made with and without it against subsequently rated titles. Using the original three films again would reward the hypothesis for explaining its own evidence.

## Reproduction

Use the same private inputs and `family-scores.json` prepared in the [metadata audit](metadata/README.md). From this folder, remove the optional public-audience field before generating native training folds. The personal models run offline with NumPy.

```sh
jq -c 'map(.history |= map(del(.audience)))' "$PRIVATE/card-spread-history.json" > "$PRIVATE/card-spread-solo.json"
bun ordinal-inputs.ts "$PRIVATE/card-spread-solo.json" "$PRIVATE/rated-dates.json" "$PRIVATE/ordinal-inputs-solo.json"
python metadata/interests.py "$PRIVATE"
```
