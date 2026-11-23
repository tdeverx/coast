"""The sensitivity variant only uses local, same-side, family-replicated corrections."""
from collections import defaultdict


def trait_proposals(model, title):
    if title is None or None not in model:
        return
    relative_medium = title.reception - model[None][0]
    for family in title.traits:
        for key in family:
            if key not in model:
                continue
            center, slope, _ = model[key]
            relative_local = title.reception - center
            if slope > 0 and relative_medium * relative_local > 0:
                yield key, (1 if relative_local > 0 else -1), title.reliability * slope * relative_local


def local_gates(rows, partitions, families, fit):
    # Each independent family's contribution is averaged, including mixed outcomes.
    data = defaultdict(lambda: defaultdict(list))
    for k in range(4):
        model = fit([r for r in rows if partitions[r[0]] != k])
        for work, title, residual in rows:
            if partitions[work] != k:
                continue
            for term, side, delta in trait_proposals(model, title):
                data[term, side][families[work]].append((delta, residual))
    out = {}
    for cell, grouped in data.items():
        if len(grouped) < 8:
            continue
        sign = cell[1]
        agree = 0
        dot = square = 0.
        for values in grouped.values():
            agree += sign * sum(y for _, y in values) > 0
            dot += sum(d * y for d, y in values) / len(values)
            square += sum(d * d for d, _ in values) / len(values)
        if 2 * agree > len(grouped) and square > .01 and 2 * dot > square:
            out[cell] = min(1., dot / square)
    return out


def local_delta(model, gates, title):
    values = defaultdict(list)
    for term, side, delta in trait_proposals(model, title):
        multiplier = gates.get((term, side), 0.)
        if multiplier:
            values[term[0]].append(delta * multiplier)
    return sum(sum(v) / len(v) for v in values.values()) / len(values) if values else 0.
