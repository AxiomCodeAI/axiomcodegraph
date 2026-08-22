"""Shared TSV reader that UNDOES EntityUtils.escapeTsv.

Reading the raw field is a trap: a value containing a double quote is wrapped
and its quotes doubled, so a quoted literal is stored with its quotes doubled and a naive reader
reports a quoting bug that does not exist. A4 fell for it once.
"""
import os

def unescape(v: str) -> str:
    if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
        v = v[1:-1].replace('""', '"')
    return v.replace("\\t", "\t").replace("\\n", "\n")

def load(path):
    text = open(path, encoding="utf-8").read()
    if not text.strip():
        return [], []
    lines = text.rstrip("\n").split("\n")
    h = lines[0].split("\t")
    rows = []
    for l in lines[1:]:
        f = l.split("\t")
        if len(f) != len(h):
            continue
        rows.append({k: unescape(v) for k, v in zip(h, f)})
    return h, rows

def loaddir(d):
    out = {}
    for fn in sorted(os.listdir(d)):
        if fn.endswith(".csv"):
            out[fn] = load(os.path.join(d, fn))
    return out
