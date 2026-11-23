"""Can agreement between two existing scores isolate disliked titles while preserving favourites?

Run with the original private scale-mode replay and final native graded replay.
Only earlier, out-of-fold predictions can teach the lower-score region.
"""
import json
import sys
from collections import Counter
from functools import lru_cache


def star_fit(stars):
    if stars <= 3:
        return max(0, 20 * (stars - .5))
    if stars <= 4:
        return 50 + 30 * (stars - 3)
    return 80 + 20 * (stars - 4)


def fit(points):
    if sum(p["stars"] <= 2.5 for p in points) < 2 or not any(p["stars"] >= 4 for p in points):
        return None
    # Train one lower-left region in the (incumbent, raw challenger) plane.
    # Use only observed cutoffs. Require at least two strict dislikes and a strict
    # dislike majority, and reject the whole region if it contains a liked title.
    best = rule = None
    for old in sorted({p["v1"] for p in points}):
        rows = sorted((p for p in points if p["v1"] <= old), key=lambda p: p["raw"])
        low = total = 0
        utility = 0.
        for i, p in enumerate(rows):
            if p["stars"] >= 4:
                break
            low += p["stars"] <= 2.5
            total += 1
            utility += star_fit(p["stars"])
            raw = p["raw"]
            if i+1 < len(rows) and rows[i+1]["raw"] == raw:
                continue
            if low < 2 or 2*low <= total or utility/total >= 50:
                continue
            # Maximise training dislike coverage, then minimise collateral and area.
            merit = (low, low-total, -old*raw, -old, -raw)
            if best is None or merit > best:
                best, rule = merit, (old, raw, round(utility/total))
    return rule


def replay(controls, graded):
    fits = {(r["medium"],r["split"],r["group"]):r["train"] for r in controls["scales"]}
    original = {(r["medium"],r["split"],r["budget"]):r["targets"] for r in controls["runs"]}
    results = []
    for run in graded["runs"]:
        key = (run["medium"],run["split"],run["budget"])
        if key not in original:
            continue
        prior = {t["id"]:t["scores"] for t in original[key]}

        @lru_cache(None)
        def region(group):
            return fit(fits[(*key[:2],group)])

        totals = Counter()
        for t in run["targets"]:
            old, raw, score = (t["scores"][k] for k in ("v1","balanced","calibrated"))
            assert old == prior[t["id"]]["v1"] and raw == prior[t["id"]]["balanced"]
            if score is None:
                continue
            rule = region(t["group"])
            changed = score
            if rule and old is not None and raw is not None and old <= rule[0] and raw <= rule[1]:
                changed = min(score,rule[2])
            stars = t["stars"]
            totals["scored"] += 1
            totals["strictDislikes"] += stars <= 2.5
            totals["strictDislikesTurnedRed"] += stars <= 2.5 and changed < 50 <= score
            totals["likedTurnedRed"] += stars >= 4 and changed < 50 <= score
            totals["fiveStarScoresLowered"] += stars == 5 and changed < score
            totals["fiveStarLostGreen"] += stars == 5 and changed < 80 <= score
            totals["weakEscapedGreen"] += stars <= 3 and changed < 80 <= score
            totals["anyChange"] += changed != score
        # Descriptive ceiling for moving the entire lower tail with one cutoff,
        # given ideal access to the held labels. This is not a deployable policy.
        targets=[t for t in run["targets"] if t["scores"]["calibrated"] is not None]
        for name, cutoff in (("five",5),("liked",4)):
            protected=[t["scores"]["calibrated"] for t in targets if t["stars"]>=cutoff]
            if protected:
                totals[name+"Floor"]=min(protected)
                totals["dislikesBelow"+name.title()+"Floor"]=sum(t["stars"]<=2.5 and t["scores"]["calibrated"]<min(protected) for t in targets)
        results.append({"medium":key[0],"split":key[1],**totals})
    return results


if __name__ == "__main__":
    if len(sys.argv)!=3:
        raise SystemExit("Usage: lower-region.py PRIVATE_INNER_SCALE_REPLAY PRIVATE_GRADED_REPLAY")
    with open(sys.argv[1]) as f:
        controls=json.load(f)
    with open(sys.argv[2]) as f:
        graded=json.load(f)
    print(json.dumps(replay(controls,graded),indent=2))
