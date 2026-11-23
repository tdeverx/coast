# External control on publicly rated movies

Early in the investigation we used MovieLens 100K to check an architecture that has access to many viewers’ ratings. This is an external reference experiment. The single-viewer Coast design uses personal history and descriptive title information, including at installations with no other users.

We used the original GroupLens archive locally for non-commercial research. The archive and derived ratings are excluded from Coast. The MovieLens dataset is documented by F. Maxwell Harper and Joseph A. Konstan, *The MovieLens Datasets: History and Context* (2015). [Dataset and terms](https://grouplens.org/datasets/movielens/100k/) · [Dataset paper](https://doi.org/10.1145/2827872)

The two held time intervals were disjoint. The first used the earliest 65% for training and the next 15% for testing. The second trained on the earliest 80% and tested the final 20%. Each user needed at least ten training ratings. Coast had genres and release decade only. The alternate methods additionally had other users’ earlier movie ratings. No future ratings entered the item similarities. We compared every method on the same scoreable rows, crediting ties half, and averaged ordering per user with both outcomes.

| Test window | Held / scoreable | Viewers with comparable opinions | Coast, genre and decade | User and movie rating biases | Biases plus comparable films |
| --- | ---: | ---: | ---: | ---: | ---: |
| 65–80% | 2,917 / 2,742 | 80 | 57.72% | 69.86% | 68.63% |
| Final 20% | 2,876 / 2,770 | 85 | 56.44% | 76.93% | 76.94% |

Accounting for neighbours gave no reliable extra ordering over the population-aware bias predictor. The paired user-bootstrap intervals for the change were −5.61 to +2.58 and −4.01 to +3.43 percentage points. This dataset does not supply Coast’s detailed cast, studio, tag and interaction evidence. Its results establish neither that community opinions are needed for Coast nor that a provider’s one aggregate can supply personalised neighbour evidence. [Neighbour scoring precedent](https://www.cs.cornell.edu/courses/cs6241/2020sp/readings/Koren-2008-Factorization.pdf)

To reproduce, run the public replay with the original archive, an output file, a dash for the optional alternate trainer, and time fractions `0.65 0.8` or `0.8 1`. Then pass the two files to the metrics script. No database or online service is used by these scripts. [Replay](public-replay.ts) · [Neighbour model](public-neighbors.ts) · [Metrics](public-metrics.py)
