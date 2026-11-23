# Why browsing scores cluster

## What we compared

On a copied account, three fixed For You visit seeds each produced 234 row definitions. We read page one from the first ten locally ranked personal shelves per visit, using the same loaders and parameters as the app. The sample contained 15 genre shelves and 15 shelves seeded by another title. We deduplicated titles both within and across visits. The primary view takes the first ten positions on each shelf. The full first pages and Recently Added supply separate checks. Results describe these shelves, not social events, remote-provider rows, or the probability that someone will scroll to a particular card.

We separate films from shows and exclude a title entirely if the profile already has history for it. That is a stricter definition than an absent star rating. We count absent predictions as coverage gaps. They do not become a neutral score. All percentages below refer to this account.

## What the dev card actually served

These values come from the selected dev publication, matched by canonical work and verified against its source digest. The catalogue comparison accepts released and undated titles, just as the personal row query does. Each range spans the 10th to 90th percentile, not the minimum and maximum.

| Population | Scored / untouched titles | Personal median and range | Selected median and range | Selected scores in 70–89 |
| --- | ---: | ---: | ---: | ---: |
| Catalogue movies | 7,123 / 7,214 | 79 · 75–82 | 79 · 75–82 | 7,105 (99.7%) |
| For You movies, first ten positions | 151 / 151 | 81 · 77–85 | 81 · 77–85 | 151 (100%) |
| Catalogue shows | 3,142 / 3,157 | 77 · 62–84 | 77 · 60–84 | 2,347 (74.7%) |
| For You shows, first ten positions | 47 / 47 | 84 · 70–86 | 84 · 70–86 | 47 (100%) |

One catalogue movie and 12 shows met the selected rules and changed score. On For You, none of the 198 titles from the first ten positions met those rules. Expanding to the full first pages yielded 568 untouched movies and 258 shows. Their median displayed matches were 80 and 81 respectively, and again none triggered a correction. Recently Added contributed only two untouched movies and 12 shows on the copied account. These separate samples overlap and cannot be summed.

The personal feed explicitly prioritises provider matches, taste shortlist scores and shared positive genres, and can generate rows around an individual title the viewer likes. It therefore favours apparent matches before the badge is calculated. That explains part of the rise in median, especially for shows. It cannot explain why almost all catalogue movies already fall in the same band. [Feed selection](../../../src/lib/recommendations/query.server.ts) · [Verified publication comparison](browse_distribution.py)

## Where the spread is lost

We also reproduced the existing personal model on the frozen catalogue control. It supplied 4,228 untouched films and 3,128 untouched shows. Of these, 4,195 films and 3,117 shows had enough shared evidence to score. The figures below are the 10th and 90th percentiles of the scored population. The personal prediction combines ratings and viewing behaviour. Signed affinities are a separate estimate from traits the viewer tends to like or dislike. At this account's history size the model gives those estimates equal weight before the display conversion.

| Frozen catalogue control | Personal prediction | Signed affinities | Combined before display | Displayed personal match |
| --- | ---: | ---: | ---: | ---: |
| Films | 78–84 | 76–84 | 78–84 | 75–82 |
| Shows | 67–85 | 75–85 | 72–85 | 62–84 |

Both film estimates are already narrow before they are averaged. The fitted display curve slightly widens the central film range and widens the central show range substantially. Among scorable control titles, 99.8% of films and 74.8% of shows end up in the 70s or 80s. Two randomly selected films receive the identical displayed integer about 13% of the time, compared with 7% for shows. The film model's rating distribution starts high. Of its 444 directly rated films, 326 received at least four stars and seven received 2½ stars or less. The corresponding show counts are 284 and 33 out of 426. The rating model's fitted typical value before title-specific terms is 76.5 for films and 70.9 for shows.

Metadata coverage alone does not explain the film result. Of scorable films in this control, 92.4% have keywords. As a diagnostic intervention we scored each work twice, with and without its tags, credited cast, creators, directors, writers, franchise, studio and network. Holding the trained profile and display map fixed, removing all those fields changed the match by at most two points for 80.5% of the 4,179 films scorable both ways. The same condition held for 58.1% of 3,109 shows. Removing genre alone lowered the median paired movie score by four points and the median paired show score by nine. These are overlapping model interventions, not additive attribution or evidence that either set of features should be removed.

## Is more spread warranted?

On the frozen single-title holdouts, 441 of 444 films scored 70–89 even after the selected rules. That band contained all seven disliked films. Across the 91 films scored 75–79, the mean forecast was 77.5 and the actual mean star utility was 74.8. Across the 260 films scored 80–84, they were 81.7 and 80.9. Across the 81 scored 85–89, they were 85.9 and 86.0. Utility follows Coast's personal scale, where three stars correspond to 50 and four to 80.

Individual film dislikes are getting missed even when the average in a score band is close. Simply enlarging the spread moves a liked and a disliked movie with the same evidence together. A targeted next test would keep calibration fixed and examine which film-specific terms distinguish an earlier unseen dislike from a comparable favourite. Require the gain to repeat on franchise and earlier-day holdouts before giving that signal more weight. Purely stretching the score cannot change that ordering.

[Feed capture](browse-cohort.ts) · [Independent component projections](browse-components.ts) · [Calibration experiment](soft-calibration.md)

## Serving check

The dynamic card scorer reproduced the distribution on the same captured card IDs. It differed from the frozen selected output on three of the 151 movies in the first ten positions and none of the 47 shows. The median and 10th–90th percentile stayed at 81 (77–85) and 84 (70–86), respectively. All 198 scored between 70 and 89. Across the released-or-undated untouched catalogue the medians stayed at 79 for movies and 77 for shows. One movie and nine shows scored below 50.
