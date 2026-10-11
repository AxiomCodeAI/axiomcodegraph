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
    # ORDER keeps repeats: three outline rows on one line, and a missing or extra repeat fails
    outline = [dict(at=a, status='match') for a in ('shop.html:8', 'shop.html:8', 'shop.html:8', 'shop.html:9')]
    def grade_role(rows, q, role):
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
            json.dump({'r': [dict(r, role=role, rank=i + 1) for i, r in enumerate(rows)]}, f)
        with tempfile.NamedTemporaryFile('w', suffix='.tsv', delete=False) as e:
            e.write(f'# reviewed: yes\n# grade=ORDER section=web role={role} fields=at filter=-\n')
            e.write(''.join(f'{x}\n' for x in q))
        rc = subprocess.run([sys.executable, os.path.join(HERE, 'grade_query.py'), f.name, e.name], capture_output=True, text=True).returncode
        os.unlink(f.name); os.unlink(e.name)
        return rc
    exp_outline = ['shop.html:8', 'shop.html:8', 'shop.html:8', 'shop.html:9']
    if grade_role(outline, exp_outline, 'outline') != 0:
        bad.append('ORDER: a sequence with repeated rows was graded wrong')
    if grade_role(outline[1:], exp_outline, 'outline') == 0:
        bad.append('ORDER: a missing repeat still passed')
    if grade_role(outline + [outline[0]], exp_outline, 'outline') == 0:
        bad.append('ORDER: an extra repeat still passed')
    # LINK (SPEC 11.2, Q36): only rows labelled asserted are graded, as a SET over (at, status)
    def grade_link(rows):
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
            json.dump({'rows': rows}, f)
        with tempfile.NamedTemporaryFile('w', suffix='.tsv', delete=False) as e:
            e.write('# reviewed: yes\n# grade=LINK section=web role=styled fields=at,status filter=asserted\n')
            e.write('partials/row.html:1\tconditional\npartials/row.html:1\tmatch\n')
        rc = subprocess.run([sys.executable, os.path.join(HERE, 'grade_query.py'), f.name, e.name], capture_output=True, text=True).returncode
        os.unlink(f.name); os.unlink(e.name)
        return rc
    own = dict(at='index.html:22', status='match', role='styled')
    frag = [dict(at='partials/row.html:1', status=st, role='styled', tier='asserted', host='index.html') for st in ('match', 'conditional')]
    if grade_link([own] + frag) != 0:
        bad.append('LINK: the asserted rows next to the host\'s own were graded wrong')
    if grade_link([own, frag[0], dict(frag[1], tier=None)]) == 0:
        bad.append('LINK: an asserted row without its label still passed')
    if grade_link([dict(own, tier='asserted')] + frag) == 0:
        bad.append('LINK: a host element labelled asserted still passed')
    for b in bad:
        print(f'  {b}')
    print(f'grade_query self-test: {15 - len(bad)}/15 checks')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
