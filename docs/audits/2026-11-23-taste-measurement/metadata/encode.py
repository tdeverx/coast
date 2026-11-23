import argparse, json, sys
from pathlib import Path

parser = argparse.ArgumentParser(
    description="Encode the replay cohort's synopses using local public model files."
)
parser.add_argument("catalogue", type=Path)
parser.add_argument("history", type=Path)
parser.add_argument("model", type=Path)
parser.add_argument("vocabulary", type=Path)
parser.add_argument("output_directory", type=Path)
args = parser.parse_args()
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "scripts"))
from encode_taste_synopses import load_encoder, tokenize, encode_batch

m, vocab = load_encoder(args.model, args.vocabulary)
table = json.loads(args.catalogue.read_text())
roots = json.loads(args.history.read_text())
rated = {
    r["work"]["id"]
    for d in roots
    for r in d["history"]
    if r["work"]["rating"] is not None
}
for cohort, rows in [
    ("rated", [r for r in table if r["id"] in rated]),
    ("others", [r for r in table if r["id"] not in rated]),
]:
    rows = [
        (row["id"], tokenize(row["overview"], vocab))
        for row in rows
        if row["overview"]
    ]
    rows.sort(key=lambda z: len(z[1]))
    encoded = []
    for i in range(0, len(rows), 24):
        seq = [toks for _, toks in rows[i : i + 24]]
        encoded.extend(encode_batch(m, seq))
    np.savez(
        args.output_directory / ("emb-" + cohort + ".npz"),
        ids=np.array([r[0] for r in rows]),
        emb=np.asarray(encoded, dtype=np.float32),
    )
    print("saved", cohort, len(rows), flush=True)
