#!/usr/bin/env python3
"""tests/row_order.py — rows tied on one file line print in one order, whatever the hash seed.

impact's "bound from outside the source" rows were sorted by (file, line) alone. One line can name a method twice (`run`
and `Step.run` in one case.json line), and the tie then fell back to the order of the set the rows came from, which is
a function of string hashing. The same check, run twice on the same graph, printed the same rows in two orders.

Each fixture is a case of tests/cases, copied to a scratch directory and indexed once. Every question is asked under
several PYTHONHASHSEED values (the only thing that differs between two runs), and the answers must be byte-identical.
The control keeps it from passing on nothing: each answer must hold two [text] rows on one file:line, the tie itself.

Symbol ids hash the index directory, so an order taken from ids differs between two copies of one tree. A name declared
in several files named its first ID as the example to target, and the unmodelled-entry signals ("NOT CHECKED: @Mapper on
its type ...") came in id order. One case is indexed at two paths and must give the same answer, paths aside; its
control is that the answer holds both the example and at least two signals.

    python3 tests/row_order.py
"""
import os, re, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AX = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode')
FIXTURES = [('java', 'a-capped-fanout-is-a-sample', 'src', [['impact', 'Step.run'], ['impact', 'Step.run', '--delete']]),
            ('python', 'unmodelled-entry-not-local', None, [['impact', 'Nightly.run']])]
SEEDS = ['0', '1', '2', '3', '4', '5']
bad = []; asked = 0
tmp = os.path.realpath(tempfile.mkdtemp(prefix='ax-row-order-'))
try:
    for lang, case, src, questions in FIXTURES:
        d = os.path.join(tmp, lang, case)
        shutil.copytree(os.path.join(ROOT, 'tests', 'cases', lang, case), d, ignore=shutil.ignore_patterns('.axiomcode'))
        r = subprocess.run(['bash', AX, 'index', d, '--lang', lang] + (['--src', src] if src else []), capture_output=True, text=True)
        if r.returncode: bad.append(f"{lang}/{case}: index failed: {(r.stderr or r.stdout)[-300:]}"); continue
        for q in questions:
            outs = {}
            for s in SEEDS:
                r = subprocess.run(['bash', AX] + q + [d], capture_output=True, text=True, env=dict(os.environ, PYTHONHASHSEED=s))
                outs[s] = r.stdout
            asked += 1
            first = outs[SEEDS[0]]
            differ = [s for s in SEEDS if outs[s] != first]
            if differ: bad.append(f"{lang}/{case} {' '.join(q)}: the answer under PYTHONHASHSEED={','.join(differ)} differs from seed {SEEDS[0]}")
            at = re.findall(r'(?m)^\s*\[text\] (\S+:\d+)\s', first)
            if not any(at.count(x) > 1 for x in at):
                bad.append(f"{lang}/{case} {' '.join(q)}: no two [text] rows on one file:line, so the order was not tested: {at}")
    # the same tree at two paths
    lang, case, q = 'java', 'mybatis-statement-in-its-namespace', ['impact', 'findById', '--page', 'all']
    answers = []
    for where in ('one', 'two-at-another-path'):
        d = os.path.join(tmp, where, case)
        shutil.copytree(os.path.join(ROOT, 'tests', 'cases', lang, case), d, ignore=shutil.ignore_patterns('.axiomcode'))
        r = subprocess.run(['bash', AX, 'index', d, '--lang', lang], capture_output=True, text=True)
        if r.returncode: bad.append(f"{lang}/{case} at {where}: index failed: {(r.stderr or r.stdout)[-300:]}"); break
        r = subprocess.run(['bash', AX] + q + [d], capture_output=True, text=True)
        answers.append(r.stdout.replace(d, '<case>'))
    if len(answers) == 2:
        asked += 1
        if answers[0] != answers[1]: bad.append(f"{lang}/{case} {' '.join(q)}: the answer differs between two paths of one tree")
        sig = re.search(r'NOT CHECKED: ([^—]*)', answers[0])
        if 'target one by file:line (e.g.' not in answers[0] or not sig or sig.group(1).count(';') < 1:
            bad.append(f"{lang}/{case} {' '.join(q)}: no example target or fewer than two unmodelled-entry signals, so the order was not tested")
finally:
    shutil.rmtree(tmp, ignore_errors=True)

for b in bad: print(f"FAIL {b}")
print(f"row_order: {asked} question(s), under {len(SEEDS)} seeds or at two paths, {'ok' if not bad else f'{len(bad)} failure(s)'}")
sys.exit(1 if bad or not asked else 0)
