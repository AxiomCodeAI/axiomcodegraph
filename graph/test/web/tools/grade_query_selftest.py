#!/usr/bin/env python3
"""Self-test of grade_query.py's per-question filters: ONE full styled_by answer for index.html:24 (every row with
its SPEC 3.3 key, as the engine prints it) must satisfy Q1, Q23, Q24 and Q28 at once, and dropping or corrupting
one row must fail the question it belongs to. Runs on the committed expectations; exit 1 on any surprise."""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
EXP = os.path.join(HERE, '..', 'expected', 'queries', '01-admin-site')
ROWS = [  # cascade order, lowest precedence first (rank)
    dict(at='css/base.css:2', status='match', reason='-', conditions='-', important_count=0),
    dict(at='css/app.css:9', status='conditional', reason='at_rule:media', conditions='@media (max-width: 600px)', important_count=0),
    dict(at='index.html:10', status='match', reason='-', conditions='-', important_count=0),
    dict(at='css/app.css:7', status='conditional', reason='state:hover', conditions='-', important_count=0),
    dict(at='css/app.css:8', status='match', reason='-', conditions='-', important_count=1),
]


def grade(rows, q):
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        json.dump({'direct': [dict(r, role='styled_by', kind='styles', rank=i + 1) for i, r in enumerate(rows)],
                   'other_languages': {}}, f)
    rc = subprocess.run([sys.executable, os.path.join(HERE, 'grade_query.py'), f.name, os.path.join(EXP, f'{q}.tsv')],
                        capture_output=True, text=True).returncode
    os.unlink(f.name)
    return rc


def main():
    bad = []
    for q in ('Q1', 'Q23', 'Q24', 'Q28'):
        if grade(ROWS, q) != 0:
            bad.append(f'{q}: the full answer was graded wrong')
    negatives = {
        'Q1': [r for r in ROWS if r['at'] != 'index.html:10'],
        'Q23': [dict(r, conditions='-') if r['at'] == 'css/app.css:9' else r for r in ROWS],
        'Q24': [dict(r, reason='-', status='match') if r['at'] == 'css/app.css:7' else r for r in ROWS],
        'Q28': [dict(r, important_count=0) for r in ROWS],
    }
    for q, rows in negatives.items():
        if grade(rows, q) == 0:
            bad.append(f'{q}: a corrupted answer still passed')
    swapped = [ROWS[2], ROWS[1], ROWS[0], ROWS[3], ROWS[4]]
    if grade(swapped, 'Q1') == 0:
        bad.append('Q1: wrong cascade order still passed')
    for b in bad:
        print(f'  {b}')
    print(f'grade_query self-test: {9 - len(bad)}/9 checks')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
