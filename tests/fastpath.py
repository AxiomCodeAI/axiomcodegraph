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

    python3 tests/fastpath.py [--lang python|java|csharp|typescript] [<case dir>]

One small case per language, each with a function taking one parameter and two callers of it, and the same four
shapes asked of each. Defaults to Python, which indexes without a TypeScript engine compile; `--lang typescript`
is the original two-root TypeScript case, unchanged. A case dir given without --lang takes the language from its
case.json, else Python. Indexes the case if it has no graph, and leaves the graph where it found it.
"""
import argparse, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
SCR = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts')
AX = os.path.join(SCR, 'axiomcode')
sys.path.insert(0, SCR)
import graph_sql

FP = os.path.join(HERE, 'fastpath_cases')

# (target, must the fast path ANSWER it?) — a parameter that does not exist is a different question and
# still belongs to the rules, so declining there is the right answer, not a gap. The same four shapes in every
# language: the function, the function with its parameter, a CALLER with its parameter, and a parameter the
# function does not have. Each target is written the way `changed` names it in that language.
def shapes(fn, caller, param='cents'):
    return [(fn, True), (f'{fn}({param})', True), (f'{caller}({param})', True), (f'{fn}(nosuch)', False)]

LANGS = {
    'typescript': (os.path.join(HERE, 'cases', 'typescript', 'scope-spanning-two-roots'),
                   shapes('formatAmount', 'subtotalLabel')),
    'python': (os.path.join(FP, 'python'), shapes('format_amount', 'subtotal_label')),
    'java': (os.path.join(FP, 'java'), shapes('Format.formatAmount', 'Invoice.subtotalLabel')),
    'csharp': (os.path.join(FP, 'csharp'), shapes('Format.FormatAmount', 'Invoice.SubtotalLabel')),
}

def _args(argv):
    ap = argparse.ArgumentParser(description='the hooks\' SQL fast path agrees with the rules, shape by shape')
    ap.add_argument('--lang', choices=sorted(LANGS))
    ap.add_argument('case', nargs='?', help='a case dir to use instead of the language\'s own (same shapes)')
    a = ap.parse_args(argv)
    lang = a.lang
    if not lang and a.case:
        try: lang = json.load(open(os.path.join(a.case, 'case.json'))).get('lang')
        except Exception: lang = None
    lang = lang if lang in LANGS else 'python'
    case, sh = LANGS[lang]
    return lang, os.path.abspath(a.case) if a.case else case, sh

# `alongside` rows (a sibling of the same type, a type in the same file) are not dependents: no call, no reference,
# only a co-change hint. The fast path covers the contract, resolved and by-name tiers (hooks/changes.py) and never
# emits them, so they are left out of the comparison and COUNTED instead. A free function has no siblings, so the
# TypeScript case never had one; a method in a class does, which is why the Java and C# cases need this.
ALONG = 'alongside'

def rels(d):
    d = d or {}
    return dict(contract=sorted({x['display'] for x in d.get('contract', [])}),
                direct=sorted({x['display'] for x in d.get('direct', []) if x.get('certainty') != ALONG}),
                reached=len(d.get('reached', [])), tests=len(d.get('tests', [])))

def main(argv=None):
    LANG, CASE, SHAPES = _args(sys.argv[1:] if argv is None else argv)
    built = os.path.exists(os.path.join(CASE, '.axiomcode', 'out', 'graph.sqlite'))
    keep = built
    if not built:
        r = subprocess.run(['bash', AX, 'index', CASE, '--lang', LANG], capture_output=True, text=True)
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
                al = sorted({x['display'] for x in j.get('direct', []) if x.get('certainty') == ALONG})
                print(f"ok   {target!r}: {len(a['direct'])} direct, {a['reached']} reached — identical to the rules"
                      + (f" (the rules also list {len(al)} `alongside` row(s), not compared: {', '.join(al)})" if al else ''))
    finally:
        if not keep:
            import shutil; shutil.rmtree(os.path.join(CASE, '.axiomcode'), ignore_errors=True)
    print(f"\n{LANG}: {len(SHAPES) - bad} of {len(SHAPES)} shape(s) ok" + (" - FAILED" if bad else ""))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
