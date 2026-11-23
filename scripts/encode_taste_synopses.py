"""Offline encoder for exported Coast synopses, using operator-supplied MiniLM weights."""
import argparse
import hashlib
import json
import unicodedata
from pathlib import Path

import numpy as np
import onnxruntime as ort

MODEL = "all-MiniLM-L6-v2:coast-wordpiece-mean-v1"


def load_encoder(model, vocabulary):
    expected = ((model, "4278337fd0ff3c68bfb6291042cad8ab363e1d9fbc43dcb499fe91c871902474"),
                (vocabulary, "07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3"))
    for path, digest in expected:
        with path.open("rb") as source:
            if hashlib.file_digest(source, "sha256").hexdigest() != digest:
                raise ValueError(f"Unexpected checksum for {path.name}")
    ort.disable_telemetry_events()
    options = ort.SessionOptions()
    options.inter_op_num_threads = 1
    options.intra_op_num_threads = 3
    session = ort.InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"])
    vocab = {word: i for i, word in enumerate(vocabulary.read_text().splitlines())}
    return session, vocab


def tokenize(s, vocab):
    s = "".join(
        c
        for c in unicodedata.normalize("NFD", s.lower())
        if unicodedata.category(c) != "Mn"
    )
    units = []
    word = ""
    for c in s:
        if c.isspace() or unicodedata.category(c)[0] == "C":
            if word:
                units.append(word)
                word = ""
        elif (
            unicodedata.category(c)[0] == "P"
            or 33 <= ord(c) <= 47
            or 58 <= ord(c) <= 64
            or 91 <= ord(c) <= 96
            or 123 <= ord(c) <= 126
        ):
            if word:
                units.append(word)
                word = ""
            units.append(c)
        else:
            word += c
    if word:
        units.append(word)
    tokens = []
    for w in units:
        if w in vocab:
            tokens.append(vocab[w])
            continue
        if len(w) > 100:
            tokens.append(100)
            continue
        seg = []
        start = 0
        while start < len(w):
            end = len(w)
            while end > start:
                sub = ("##" if start else "") + w[start:end]
                if sub in vocab:
                    break
                end -= 1
            if start == end:
                seg = [100]
                break
            seg.append(vocab[sub])
            start = end
        tokens.extend(seg)
    return [101] + tokens[:254] + [102]


def encode_batch(session, seq):
    # Length ordering also reproduces the batch padding used by the offline replay.
    width = max(map(len, seq))
    ids = np.array([s + [0] * (width - len(s)) for s in seq], dtype=np.int64)
    mask = (ids != 0).astype(np.int64)
    out = session.run(
        None,
        {
            "input_ids": ids,
            "attention_mask": mask,
            "token_type_ids": np.zeros_like(ids),
        },
    )[0]
    v = (out * mask[:, :, None]).sum(1) / mask.sum(1)[:, None]
    v /= np.maximum(1e-12, np.linalg.norm(v, axis=1)[:, None])
    return v.astype(np.float32)


def write_vectors(session, vocab, batch, output):
    tokens = [tokenize(row["overview"], vocab) for row in batch]
    for row, vector in zip(batch, encode_batch(session, tokens)):
        digest = hashlib.sha256(row["overview"].encode("utf-8")).hexdigest()
        if row["hash"] != digest:
            raise ValueError("Synopsis hash differs from the exported text")
        output.write(json.dumps({"id": row["id"], "hash": digest, "model": MODEL,
                                 "embedding": vector.tolist()}, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("export", "model", "vocabulary", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    session, vocab = load_encoder(args.model, args.vocabulary)
    with args.export.open() as source, args.output.open("x") as destination:
        batch = []
        for line in source:
            batch.append(json.loads(line))
            if len(batch) == 24:
                write_vectors(session, vocab, batch, destination)
                batch.clear()
        if batch:
            write_vectors(session, vocab, batch, destination)
