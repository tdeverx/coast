# Evidence on other works for matched dislikes and favourites

The earlier [component audit](../2026-11-23-taste-dislikes/breakdowns.md) paired each of the 40 disliked titles with the five-star title sharing the most weighted metadata in the same whole-title holdout fold. We kept those exact pairs. They cover 29 distinct favourites. Twenty-six pairs shared a specific tag, studio, network or person beyond broad genres. Two had no shared descriptor at all. The five-star label selects an example to explain after scoring and never becomes a predictor.

## How often was a distinguishing clue available?

For each pair, exclude both held-out works, their whole testing fold and both of their franchises. Compare the viewer's verified direct ratings on other works with a trait exclusive to either member. Each unrelated franchise counts once. A recurring negative trait needed at least two independent families rated 2½ stars or lower and a strict majority of such families. A recurring positive trait needed at least two families rated four stars or higher, a strict majority of such families and no disliked family. We inspect fine tags, themes, people, studios and networks. A holding by genre alone is too broad to qualify.

| Evidence in the training works | Movies, 7 pairs | Shows, 33 pairs |
| --- | ---: | ---: |
| Exclusive recurring negative trait on the disliked title | 0 | 7 |
| Exclusive recurring negative trait on the paired five-star | 0 | 0 |
| Exclusive recurring positive trait on the disliked title | 5 | 23 |
| Exclusive recurring positive trait on the paired five-star | 7 | 33 |
| Another directly rated instalment in the disliked title's franchise outside its fold | 2 | 0 |

The seven shows reduced to **one recurring studio, one recurring network and one cast member**. Each was present in three diagnosed shows, with two shows contributing to two categories. Those counts are not nine independent patterns. None of the pairs supplied independently repeated, majority-negative tags, directors, writers or creators under this definition. One other work from the exact same creative team is a different, considerably less demanding rule. Nearly three quarters of the disliked titles (28/40) also had exclusive traits with a strong positive track record. A simple count of positive traits would flatter those dislikes.

The two films with directly rated franchise relatives both had a prior 4½-star instalment outside their holdout fold. A personal franchise match alone would give both a boost. Only one of those two offered the additional clue of successively lower ratings on two earlier numbered instalments. This account supplies no basis for a general sequel penalty.

## Watching behaviour and coverage

The frozen root summaries record no explicit drop or deliberate whole-work return for any rated dislike or five-star favourite. Seven of seven disliked films and 66 of 66 five-star films are marked completed. Shows have a difference on their own completion (10/33 dislikes and 34/59 favourites), but using it for the held-out target would reveal what the viewer went on to do. Similarities to the viewer's actions on *other* shows can legitimately be tested. Multiple episode plays can exist even where the capture's more restrictive whole-series deliberate-return flag is false. [History evidence](../2026-11-23-taste-measurement/implicit.md)

## Independent creative-team check

We separately reconstructed the identical-lead-team score correction using its frozen native inner predictions and verified direct stars. No candidate-scoring implementation was imported. On whole titles the four successfully identified shows came from two reciprocal pairs: every success used the paired title as its only training example. Only one of those four also had a properly earlier, independently rated match supplying a true red in the chronological test. The same one-donor rule gave a four-star movie a false red. Requiring two unrelated donor franchises recovered zero on the whole-title test. Holding out the entire connected lead team together with each franchise would remove the very evidence the rule uses; it has no coverage for a previously unseen team. Results across different work partitions must therefore not be counted as independent evidence for four distinct preferences. [Creative-team protocol](lineage-protocol.md) · [Follow-up rule](lineage-exact.md)

We then independently checked the [same-kind restriction](same-kind.md) using genre-set overlap. This retained the same four successes and prevented the film mistake. Across all 32 panels exactly 15 predictions changed. They consist of repeated appearances of the same four disliked shows from the same two creator teams. Every other personal score stayed the same. One dated prediction qualified and moved below neutral. Requiring two qualifying donor franchises changed zero scores across all panels. The independently reconstructed variants matched 320 reported counts for changes, true reds, false reds on liked titles, five-star green losses and any downward effect on five-star titles.

## Reproduce

The pair audit produces aggregate counts under stdout. An optional exclusively created, owner-only file retains personal title names and training examples. The independent team replay prints aggregate score-change counts. Both scripts read only frozen local inputs.

```sh
python3 -B pairs.py "$capture" "$metadata" "$verified_dates" "$graded_replay" "$previous_breakdowns_jsonl"
python3 -B pairs-team-check.py "$metadata" "$verified_dates" "$graded_replay" "$inner_personal_scores"
python3 -B pairs-team-check.py "$metadata" "$verified_dates" "$graded_replay" "$inner_personal_scores" "$capture"
```
