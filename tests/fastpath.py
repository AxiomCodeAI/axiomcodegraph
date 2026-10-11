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

One small case per language, each with a function taking one parameter and two callers of it (two methods of one
class, so each caller has a sibling), and the same shapes asked of each. Then the hook itself (hooks/changes.py) is run
on one edit twice, once as it is and once with the fast path switched off, and the two lists it prints must name the
same rows. Defaults to Python, which indexes without a TypeScript engine compile; `--lang typescript`
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
# The fifth shape, the caller by bare name, has NO use at all in these cases, only siblings: on it the rules' answer
# is nothing but `alongside` rows, so it is the shape where listing them would be most of what the hook says.
def shapes(fn, caller, param='cents'):
    return [(fn, True), (f'{fn}({param})', True), (f'{caller}({param})', True), (f'{fn}(nosuch)', False),
            (caller, True)]

LANGS = {
    'typescript': (os.path.join(HERE, 'cases', 'typescript', 'scope-spanning-two-roots'),
                   shapes('formatAmount', 'subtotalLabel')[:4]),
    'python': (os.path.join(FP, 'python'), shapes('format_amount', 'Invoice.subtotal_label')),
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

# `direct` is compared as the HOOKS take it, through graph_sql.hook_direct, the one function both hooks read their rows
# through: every tier, except `alongside` (a sibling of the same type, a type in the same file: no call, no reference,
# only a co-change hint), which neither path lists in a hook. The rules still emit alongside rows; they are counted,
# and a run where the rules never emitted one fails, because then this check would pass on nothing.
ALONG = 'alongside'

# WHERE AN ALONGSIDE ROW LIVES. The rules used to carry them in `direct` with certainty `alongside`; since they are
# listed apart (never as dependents) they sit in their own `alongside` list, and `direct` holds dependents only. Read
# both places, on BOTH paths, so a move of the section cannot turn the tier into a comparison of nothing again: the
# counting below found no row after the move and would have passed silently had it not also required one.
def along_rows(d):
    d = d or {}
    return ({x['display'] for x in d.get('direct', []) if x.get('certainty') == ALONG}
            | {x['display'] for x in d.get(ALONG, [])})

# A ROW IS A DECLARATION, NOT A NAME: `direct` is compared with where each row is. Every arrow of a file is `<arrow>`,
# every module body of a basename `app.<module>`; compared as a set of names, one row located at the first arrow in the
# table matched the rules' two rows at their own lines (the hook said "called by <arrow>" at a test the caller is not in)
def rels(d):
    d = d or {}
    return dict(contract=sorted({x['display'] for x in d.get('contract', [])}),
                direct=sorted({(x['display'], x.get('at') or '') for x in graph_sql.hook_direct(d)}),
                reached=len(d.get('reached', [])), tests=len(d.get('tests', [])))

# THE HOOK ON ONE EDIT, BOTH PATHS. The comparison above is of the dicts; this is of what the hook PRINTS, because
# that is what an agent reads, and a hook that took `direct` straight from the dict instead of through hook_direct
# would pass the check above and still list siblings when the rules answered. The edit retypes (Python: extends) the
# caller's parameter, which is the `Owner.m(param)` shape `changed` emits; the caller has no use, only a sibling.
EDITS = {
    'python': ('orders/invoice.py', 'def subtotal_label(self, cents):', 'def subtotal_label(self, cents, sep=": "):'),
    'java': ('src/main/java/shop/orders/Invoice.java', 'subtotalLabel(long cents)', 'subtotalLabel(int cents)'),
    'csharp': ('Orders/Invoice.cs', 'SubtotalLabel(long cents)', 'SubtotalLabel(int cents)'),
}
HOOK = os.path.join(ROOT, 'plugins', 'axiomcode', 'hooks', 'changes.py')
# the rules path is taken by making the fast path decline, exactly as it does for a shape it does not cover
RUN_HOOK = ("import runpy, sys; sys.path.insert(0, sys.argv[1]); import graph_sql\n"
            "if sys.argv[2] == 'rules': graph_sql.impact_shaped = lambda *a, **k: None\n"
            "sys.argv = [sys.argv[3]]; runpy.run_path(sys.argv[0], run_name='__main__')")
ROW = __import__('re').compile(r'\[([^\]]+)\] (\S+) \S+:\d+')

def hook_rows(case, lang, path):
    rel, old, new = EDITS[lang]
    sid = f'fastpath-{path}-{os.getpid()}'
    ev = dict(hook_event_name='PreToolUse', tool_name='Edit', cwd=case, session_id=sid,
              tool_input=dict(file_path=os.path.join(case, rel), old_string=old, new_string=new))
    r = subprocess.run([sys.executable, '-c', RUN_HOOK, SCR, path, HOOK], input=json.dumps(ev), capture_output=True,
                       text=True, cwd=case, timeout=60)
    try: os.remove(os.path.join(case, '.axiomcode', f'hooks-state-{sid}.json'))
    except OSError: pass
    try: text = json.loads(r.stdout)['hookSpecificOutput']['additionalContext']
    except Exception: return None, (r.stdout + r.stderr)[-300:]
    rows = [m for l in text.splitlines() if l.lstrip().startswith(('reads / uses it', 'produces / writes it'))
            for m in ROW.findall(l)]
    return rows, text

def check_hook(case, lang, siblings=frozenset()):
    """`siblings`: the rules' alongside rows for the edit's target, `Owner.m(param)`; neither path may list them."""
    if lang not in EDITS: return 0
    got = {}
    for path in ('fast', 'rules'):
        rows, text = hook_rows(case, lang, path)
        if rows is None:
            print(f"FAIL hook ({path}): no block for the edit: {text!r}"); return 1
        tag = '[fast path]' if path == 'fast' else '[rules]'
        if tag not in text:
            print(f"FAIL hook ({path}): the block does not say {tag} answered, so this compared the wrong path"); return 1
        if any(c == ALONG for c, _ in rows):
            print(f"FAIL hook ({path}): lists `alongside` rows as uses: {sorted(d for c, d in rows if c == ALONG)}"); return 1
        got[path] = sorted({d for _, d in rows})
        if set(got[path]) & set(siblings):
            print(f"FAIL hook ({path}): lists the rules' `alongside` rows as uses: {sorted(set(got[path]) & set(siblings))}"); return 1
    if got['fast'] != got['rules']:
        print(f"FAIL hook: the same edit lists different rows by path: fast={got['fast']}  rules={got['rules']}"); return 1
    print(f"ok   hook on {EDITS[lang][0]}: both paths list {got['fast']}")
    return 0

def main(argv=None):
    LANG, CASE, SHAPES = _args(sys.argv[1:] if argv is None else argv)
    built = os.path.exists(os.path.join(CASE, '.axiomcode', 'out', 'graph.sqlite'))
    keep = built
    if not built:
        r = subprocess.run(['bash', AX, 'index', CASE, '--lang', LANG], capture_output=True, text=True)
        if r.returncode: print("FAIL index: " + (r.stderr or r.stdout)[-400:]); return 1
    bad = 0; along = set(); along_of = {}
    # THE SHAPE `changed` NOW EMITS FOR EVERY EDIT: file:line, the declaration edited, and file:line(p) for a parameter.
    # A name answered for every declaration carrying it; the fast path must answer the line for that one alone.
    import sqlite3
    fn = SHAPES[0][0].replace('#', '.').rsplit('.', 1)[-1]; par = SHAPES[1][0].rsplit('(', 1)[-1].rstrip(')')
    con = sqlite3.connect(os.path.join(CASE, '.axiomcode', 'out', 'graph.sqlite'))
    at = con.execute("SELECT file, line FROM symbols WHERE name=? AND method_id IS NOT NULL ORDER BY file, line LIMIT 1", (fn,)).fetchone()
    con.close()
    if at: SHAPES = SHAPES + [(f"{at[0]}:{at[1]}", True), (f"{at[0]}:{at[1]}({par})", True)]
    else: print(f"FAIL: {fn} is not in the graph, so its file:line shapes cannot be asked"); bad += 1
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
            fa, ra = along_rows(fast), along_rows(j)
            along |= ra; along_of[target] = ra
            # the alongside tier, compared: the fast path has no rule for it, so any row it emits there (in either
            # place) disagrees with the rules, whether or not the rules have the same row
            if fa:
                print(f"FAIL {target!r}: fast path and rules disagree on `alongside` rows, which the fast path has no "
                      f"rule for: fast={sorted(fa)}  rules={sorted(ra)}"); bad += 1; continue
            a, b = rels(fast), rels(j)
            # and neither path may list one of the rules' alongside rows as a dependent in a hook
            listed = {p: sorted(ra & {x for x, _ in r['direct']}) for p, r in (('fast', a), ('rules', b))}
            if any(listed.values()):
                print(f"FAIL {target!r}: the rules' `alongside` rows are listed as direct uses: {listed}"); bad += 1; continue
            if a != b:
                print(f"FAIL {target!r}: fast path and rules disagree")
                for k in a:
                    if a[k] != b[k]: print(f"       {k}: fast={a[k]}  rules={b[k]}")
                bad += 1
            else:
                al = sorted(ra)
                print(f"ok   {target!r}: {len(a['direct'])} direct, {a['reached']} reached — identical to the rules"
                      + (f" (neither lists the rules' {len(al)} `alongside` row(s) as direct: {', '.join(al)})" if al else ''))
        if LANG in EDITS:
            if not along:
                print(f"FAIL the rules emitted no `alongside` row on any shape, so the tier was never compared"); bad += 1
            bad += check_hook(CASE, LANG, along_of.get(SHAPES[2][0], set()))
    finally:
        if not keep:
            import shutil; shutil.rmtree(os.path.join(CASE, '.axiomcode'), ignore_errors=True)
    n = len(SHAPES) + (LANG in EDITS)
    print(f"\n{LANG}: {n - bad} of {n} check(s) ok" + (" - FAILED" if bad else ""))
    return 1 if bad else 0

if __name__ == '__main__':
    sys.exit(main())
