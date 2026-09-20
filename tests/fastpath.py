#!/usr/bin/env python3
"""tests/fastpath.py — the hooks' SQL fast path agrees with the rules, on the target shapes an EDIT produces.

`hooks/changes.py` calls `graph_sql.impact_shaped` first and falls back to `axiomcode-impact` (Datalog) only
when it returns None. Two things can go wrong and neither announces itself:

  · it DECLINES a shape the rules answer — the fallback then has to make the hook's 14 s budget, which on a
    large graph it does not, and the hook prints "(impact unavailable)". That was #1033 for `Owner.m(p)`,
    the shape `changed` emits for a RETYPED PARAMETER: the lookup is an exact match on `display`, which no
    parenthesised target can equal.
  · it ANSWERS but disagrees with the rules. Comparing rendered output hides this, because a relation that
    is empty on both sides reads as a match — so this compares the relations themselves, as SETS.

    python3 tests/fastpath.py [<case dir>]

Defaults to the two-root TypeScript case, which has a free function with one parameter and two callers of it.
Indexes it if it has no graph, and leaves the graph where it found it.
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
SCR = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts')
AX = os.path.join(SCR, 'axiomcode')
sys.path.insert(0, SCR)
import graph_sql

CASE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'cases', 'typescript', 'scope-spanning-two-roots')

# (target, must the fast path ANSWER it?) — a parameter that does not exist is a different question and
# still belongs to the rules, so declining there is the right answer, not a gap.
SHAPES = [('formatAmount', True), ('formatAmount(cents)', True), ('subtotalLabel(cents)', True),
          ('formatAmount(nosuch)', False)]

def rels(d):
    d = d or {}
    return dict(contract=sorted({x['display'] for x in d.get('contract', [])}),
                direct=sorted({x['display'] for x in d.get('direct', [])}),
                reached=len(d.get('reached', [])), tests=len(d.get('tests', [])))

def main():
    built = os.path.exists(os.path.join(CASE, '.axiomcode', 'out', 'graph.sqlite'))
    keep = built
    if not built:
        r = subprocess.run(['bash', AX, 'index', CASE, '--lang', 'typescript'], capture_output=True, text=True)
        if r.returncode: print("FAIL index: " + (r.stderr or r.stdout)[-400:]); return 1
    bad = 0
    try:
        for target, must_answer in SHAPES:
            fast = graph_sql.impact_shaped(CASE, target)
            if fast is None:
                if must_answer:
                    print(f"FAIL {target!r}: the fast path DECLINED a shape an edit produces — the hook falls back "
                          f"into a 14 s budget and prints '(impact unavailable)' (#1033)"); bad += 1
                else:
                    print(f"ok   {target!r}: declined, as the rules own this one")
                continue
            if not must_answer:
                print(f"FAIL {target!r}: the fast path answered a shape it cannot resolve"); bad += 1; continue
            cli = subprocess.run([sys.executable, os.path.join(SCR, 'axiomcode-impact'), target, CASE,
                                  '--json', '--depth', '12'], capture_output=True, text=True)
            try: j = json.loads(cli.stdout)
            except Exception: print(f"FAIL {target!r}: the rules gave no JSON to compare against"); bad += 1; continue
            a, b = rels(fast), rels(j)
            if a != b:
                print(f"FAIL {target!r}: fast path and rules disagree")
                for k in a:
                    if a[k] != b[k]: print(f"       {k}: fast={a[k]}  rules={b[k]}")
                bad += 1
            else:
                print(f"ok   {target!r}: {len(a['direct'])} direct, {a['reached']} reached — identical to the rules")
    finally:
        if not keep:
            import shutil; shutil.rmtree(os.path.join(CASE, '.axiomcode'), ignore_errors=True)
    print(f"\n{len(SHAPES) - bad} of {len(SHAPES)} shape(s) ok" + (" - FAILED" if bad else ""))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
