#!/usr/bin/env python3
"""
Compare the engine's per-site answers with the compiler's, as a golden.

One line per site the compiler DECIDED, with the scorer's bucket, sorted — so the
golden is the complete adjudication and a rule change moves a visible line. A site that
turns MISSED or WRONG fails the run whether or not the golden was rewritten:
--bless cannot bless away a regression against the compiler.

Usage: oracle_diff.py <ir-dir> <engine-out-dir> <oracle.tsv> <score-rows.tsv>
       (score-rows.tsv is produced by ground-truth/score.py --dump)
"""
import csv
csv.field_size_limit(10**9)   # an IR literalValue can be a base64 asset; see test/tools/csv-limit-test.sh
import sys

rows = list(csv.reader(open(sys.argv[4]), delimiter='\t'))
h = rows[0]
out = []
bad = 0
for r in rows[1:]:
    d = dict(zip(h, r))
    if d['bucket'] in ('UNDECIDED',):
        continue
    out.append('%s:%s:%s %s %s  %s  %s' % (d['file'], d['line'], d['col'], d['callKind'], d['callee'], d['bucket'], d['targets'].split(' | ')[-1]))
    if d['bucket'] in ('MISSED', 'WRONG', 'LIB_WRONG', 'ENGINE_DROPPED'):
        bad += 1
for l in sorted(out):
    print(l)
print('# defects: %d' % bad)
