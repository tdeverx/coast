# Can moving on after a trial identify similar shows the viewer will dislike?

On the 873 original whole-title predictions, watching and moving on from other works recovered **0 of 40 dislikes** and preserved every five-star score. The account supplied four shows meeting the early-exit definition. Three had no verified rating and the viewer rated the fourth five stars. An apparently clear decision to stop watching was a poor substitute for a negative opinion.

## What the watch records supported

The experiment used 20,138 tracked movie and episode marks and the catalogue's dated episode and movie-franchise supply. It required affirmative evidence that the viewer chose other titles after sampling a show or entering a film franchise with a sequel available. The [rule fixed before testing](behaviour-protocol.md) defines the 90-day window, credible watches and similarity. A full replay uses only the independent works allowed in that specific fold.

| Behaviour on all familiar works | Titles | Verified ratings | Rated at most 2½ | Rated at least 4 | Rated 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sampled show, then switched | 4 | 1 | 0 | 1 | 1 |
| Sustained show over multiple days | 29 | 21 | 0 | 16 | 7 |
| Watched a film, left the available franchise and chose other films | 4 | 1 | 0 | 1 | 0 |
| Watched the eligible sequel within 90 days | 0 | 0 | 0 | 0 | 0 |

Other bookkeeping already established that there were no explicit dropped screen titles, no recorded deliberate rewatch starts and no substantial personal Coast playback sessions among the 50 personal sessions. Imported timing contains bulk marks and release-day clock patterns. Repeatedly choosing a franchise over a longer horizon is more common but previously identified strong positives without identifying dislikes. [Event evidence](../2026-11-23-taste-measurement/implicit.md) · [Longer-horizon returns](../2026-11-23-taste-measurement/personal-choice.md)

## Transferring the signal to a new title

For each candidate, we compared the two nearest independent switched-away families with the two nearest sustained families using genres, tags and creative credits. Its predicted adjustment depended on how that contrast explained the viewer's earlier out-of-sample personal errors. Every anchor, including outside viewing used to qualify an exit, excludes the held cohort. The candidate's own tracking and rating are hidden. Generic reviews and public reception supply no input.

The transfer had enough neighbours for 305 of 429 whole-title shows and no movies. Among comparable shows, the 12 dislikes had a mean early-exit similarity contrast of −0.149 and the 49 five-star favourites had a mean contrast of −0.135. Negative in this diagnostic means greater resemblance to sustained choices. Both groups leaned the same way. None of the five whole-title training folds supported a strong enough negative residual slope. The alternate show franchise split changed a single score, with no dislikes recovered. On two 50-rating show masks it pushed one five-star score out of green per mask; the same title may appear more than once across masks.

The 32 panels preserve all 13,477 originally scored appearances. In the event-time chronological replay, each training example also used only other watch events from before its own recorded rating day. It changed none of the date predictions. The earliest actual ingestion of a dated movie or episode mark in the copied database was 3 October 2026 at 04:33 UTC. Only two verified movie ratings and zero show ratings occur after that date. Under strict Coast recording-time availability, the 16 independently rated training contexts could therefore never qualify on a rating-date forecast. Current release metadata approximates historical opportunity, and a release does not prove the viewer had access.

## Reproduce

Use the archival event inputs from the [behaviour audit](../2026-11-23-taste-measurement/implicit.md), the [frozen personal scorer inputs](../2026-11-23-taste-v2/README.md) and the masked inner-family personal predictions from the [TMDB study's baseline regeneration](../2026-11-23-taste-audience/inner.ts). Only the IDs and predicted personal baseline scores from that last file enter training. The script uses the standard Python library and has no database writes.

```sh
python3 -B behaviour.py "$solo_capture" "$private_events" "$verified_dates" "$frozen_graded" "$inner_personal_scores" "$descriptive_metadata"
```

The [aggregate panel results](behaviour-results.json) omit title identities and account data. The optional `COAST_BEHAVIOUR_PRIVATE` destination creates a new private file of individual paired predictions. [Implementation](behaviour.py)
