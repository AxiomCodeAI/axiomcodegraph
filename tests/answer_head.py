#!/usr/bin/env python3
"""tests/answer_head.py — the places view says what the question resolved to before its places.

The front door (MCP and the installed `axiomcode`) answers impact, path and tests as numbered places built from the
verb's --json document (ax_blocks.py), capped at ten. The verb's own summary was prose and never reached that view, so
`path main '*'` on a tree with 22 functions named `main` opened at a test script's row 1 and read as one start, and a
closure of thousands of methods showed no count and no hop distribution. Each document below is the shape the verb
writes; no graph and no engine are needed.

    python3 tests/answer_head.py
"""
import os, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts'))
import ax_blocks, ax_grep

fails = []
def check(ok, why, detail=''):
    print(('ok   ' if ok else 'FAIL ') + why + ('' if ok else '\n     ' + str(detail).replace('\n', '\n     ')))
    if not ok: fails.append(why)


def closure(label, n, up=False, test=0):
    return {'direction': 'up' if up else 'down', 'label': label, 'declarations': n, 'methods': 7, 'files': 2,
            'test': test, 'by_hop': {'1': 3, '2': 4}, 'depth': None}


repo = tempfile.mkdtemp(prefix='ax-head-')
with open(os.path.join(repo, 'a.ts'), 'w') as f:
    f.write('function main() {\n  run();\n}\nfunction run() {}\n')
reached = [{'name': 'run', 'at': 'a.ts:4', 'hops': 1}]

# a '*' closure from a name with several declarations: the summary and the ambiguity both lead the answer
doc = {'reached': reached, 'closure': closure('main (22 declarations)', 22, test=5), 'verified': True}
out = ax_blocks.render('path', doc, repo)
check(out and out[0].startswith('everything reached from main (22 declarations): 7 method(s) in 2 file(s), 5 of them test'),
      'a closure opens with what it reached, before row 1', out)
check(out and 'by hop: 1:3, 2:4' in out[0], 'the closure line carries the count per hop', out)
check(any(l.startswith('`main` matches 22 declarations') for l in out or []), 'a start naming 22 declarations says so', out)

# upstream closure
doc = {'reached': reached, 'closure': closure('run', 1, up=True), 'verified': True}
out = ax_blocks.render('path', doc, repo)
check(out and out[0].startswith('everything that can reach run: 7 method(s)'), "path '*' X opens with what can reach X", out)
check(not any('matches' in l for l in out or []), 'control: a one-declaration end adds no ambiguity line', out)

# a chain whose start is ambiguous; and its control, a chain whose ends are one declaration each
hop = {'to': 'run', 'tier': 'known_edge', 'call_at': 'a.ts:2', 'is_call': True}
amb = {'answers': [{'from': 'main', 'hops': [hop]}], 'verified': True,
       'ends': {'from': {'label': 'main (3 declarations)', 'declarations': 3}, 'to': {'label': 'run', 'declarations': 1}}}
out = ax_blocks.render('path', amb, repo)
check(out and out[0].startswith('`main` matches 3 declarations'), 'path A B: an ambiguous end is named first', out)
one = dict(amb, ends={'from': {'label': 'main', 'declarations': 1}, 'to': {'label': 'run', 'declarations': 1}})
check(ax_blocks.render('path', one, repo)[0].startswith('1. a.ts:2'), 'control: a chain between single declarations is unchanged', ax_blocks.render('path', one, repo))
legacy = {k: v for k, v in amb.items() if k != 'ends'}
check(ax_blocks.render('path', legacy, repo)[0].startswith('1. a.ts:2'), 'control: a document without the new fields renders as before', ax_blocks.render('path', legacy, repo))

# impact on a name with several declarations, and its control
imp = {'targets': [{'kind': 'method', 'label': 'run (4 declarations)', 'declarations': 4}],
       'direct': [{'id': 'm', 'display': 'main', 'at': 'a.ts:2', 'certainty': 'resolved', 'why': 'calls it'}], 'verified': True}
out = ax_blocks.render('impact', imp, repo)
check(out and out[0].startswith('`run` matches 4 declarations'), 'impact: an ambiguous name is named first', out)
imp1 = dict(imp, targets=[{'kind': 'method', 'label': 'run', 'declarations': 1}])
check(ax_blocks.render('impact', imp1, repo)[0].startswith('1. a.ts:2'), 'control: impact on one declaration is unchanged', ax_blocks.render('impact', imp1, repo))

# several language graphs: each closure line names its graph
multi = {'language': 'typescript', 'reached': reached, 'closure': closure('main (22 declarations)', 22),
         'other_languages': {'java': {'reached': [], 'closure': closure('main', 1)}}}
h = ax_grep.head('path', multi)
check(h[0].startswith('[typescript] everything reached from main (22 declarations)') and any(l.startswith('[java] everything reached from main:') for l in h),
      'with several graphs, each closure line names its graph', h)
check(not ax_grep.head('path', {'reached': reached, 'closure': closure('main', 1)})[0].startswith('['), 'control: one graph, no graph label')

# the grep view (`--grep`) leads with the same lines
g = ax_grep.render('path', {'reached': reached, 'closure': closure('main (22 declarations)', 22)}, repo)
check(g and g[0].startswith('everything reached from main (22 declarations)'), 'the grep view leads with the same summary', g)

print(f"\n{'FAIL' if fails else 'ok'}: {len(fails)} failure(s)")
sys.exit(1 if fails else 0)
