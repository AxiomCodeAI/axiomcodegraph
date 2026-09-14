#!/usr/bin/env python3
"""ARITY / DECL GUARD — catches the two failure modes a wrong column count produces.

Souffle reports both, but only after ~40s of C++ compilation, and its message names the
line, not the column you meant. This runs in milliseconds:

  1. every reference to a BASE relation (py_* / lib_py_*) has the arity decls_base.dl declares;
  2. every DERIVED relation appearing in a rule head has a decl in decls_all.dl, and every
     reference to it uses that arity;
  3. every relation in export_manifest.tsv is declared and is actually produced by some rule.

usage: check_arity.py [--lang python]
exit 1 on any violation.
"""
import os, re, sys, glob, collections

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
LANG = 'python'
if '--lang' in sys.argv:
    LANG = sys.argv[sys.argv.index('--lang') + 1]
SRC = os.path.join(ROOT, 'graph', LANG)

DECL_RE = re.compile(r'^\.decl\s+(\w+)\s*\(([^)]*)\)', re.M)

def read_decls(path):
    out = {}
    if not os.path.exists(path):
        return out
    for m in DECL_RE.finditer(open(path).read()):
        out[m.group(1)] = len([c for c in m.group(2).split(',') if c.strip()])
    return out

base = read_decls(os.path.join(SRC, 'souffle', 'decls_base.dl'))
derived = read_decls(os.path.join(SRC, 'souffle', 'decls_all.dl'))
declared = dict(base); declared.update(derived)

files = sorted(glob.glob(os.path.join(SRC, 'engine', '*', '*.dl')))
errors, heads, refs = [], collections.defaultdict(list), collections.defaultdict(list)


def strip_comments(text):
    out, i, n = [], 0, len(text)
    while i < n:
        if text.startswith('//', i):
            j = text.find('\n', i)
            i = n if j < 0 else j
        else:
            out.append(text[i]); i += 1
    return ''.join(out)


def split_top(args):
    """Split an argument list on top-level commas (nested parens/brackets/strings ignored)."""
    parts, depth, cur, q = [], 0, [], False
    for ch in args:
        if q:
            cur.append(ch)
            if ch == '"':
                q = False
            continue
        if ch == '"':
            q = True; cur.append(ch); continue
        if ch in '([{':
            depth += 1
        elif ch in ')]}':
            depth -= 1
        if ch == ',' and depth == 0:
            parts.append(''.join(cur)); cur = []
        else:
            cur.append(ch)
    if ''.join(cur).strip() or parts:
        parts.append(''.join(cur))
    return [p for p in parts]


ATOM = re.compile(r'\b([a-z_][A-Za-z0-9_]*)\s*\(')

for f in files:
    text = strip_comments(open(f).read())
    # statements end at '.' followed by newline/space at depth 0 — approximate by splitting on
    # ".\n" which is how every rule in this tree is written.
    for stmt in re.split(r'\.\s*\n', text):
        stmt = stmt.strip()
        if not stmt or stmt.startswith('.'):
            continue
        head = stmt.split(':-')[0]
        # collect every atom in the statement with its arity
        for m in ATOM.finditer(stmt):
            name = m.group(1)
            if name in ('count', 'min', 'max', 'sum', 'cat', 'strlen', 'substr', 'ord', 'to_number',
                        'to_string', 'match', 'contains', 'range', 'as', 'autoinc'):
                continue
            # find the matching close paren
            depth, i, q = 0, m.end() - 1, False
            while i < len(stmt):
                ch = stmt[i]
                if q:
                    if ch == '"':
                        q = False
                elif ch == '"':
                    q = True
                elif ch == '(':
                    depth += 1
                elif ch == ')':
                    depth -= 1
                    if depth == 0:
                        break
                i += 1
            args = stmt[m.end():i]
            n = len(split_top(args))
            rel = os.path.relpath(f, ROOT)
            refs[name].append((rel, n))
            if m.start() < len(head):
                heads[name].append((rel, n))

for name, uses in sorted(refs.items()):
    if name not in declared:
        if name in heads:
            errors.append(f"UNDECLARED derived relation '{name}' (head in {heads[name][0][0]}) — add a .decl to src/{LANG}/souffle/decls_all.dl")
        continue
    want = declared[name]
    for rel, n in uses:
        if n != want:
            kind = 'BASE (GENERATED — never hand-edit)' if name in base else 'derived'
            errors.append(f"ARITY {name}/{n} used in {rel} but declared /{want}  [{kind}]")

# a base relation must never appear in a rule HEAD: the parser owns those facts
for name in heads:
    if name in base:
        errors.append(f"BASE relation '{name}' appears in a rule head ({heads[name][0][0]}) — base facts are the parser's, not the engine's")

# every declared derived relation should be produced somewhere (dead decl = drift)
for name in derived:
    if name in ('dispatch_cap', 'jdk_max_depth', 'lib_max_depth', 'taint_gating'):
        continue          # executor knobs: staged as .input, never derived
    if name not in heads:
        errors.append(f"DEAD decl '{name}' in decls_all.dl — declared but no rule derives it")

man = os.path.join(SRC, 'souffle', 'export_manifest.tsv')
if os.path.exists(man):
    for line in open(man):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        pred = line.split('\t')[0]
        if pred not in declared:
            errors.append(f"EXPORT '{pred}' in export_manifest.tsv is not declared")
        elif pred not in heads and pred not in base:
            errors.append(f"EXPORT '{pred}' in export_manifest.tsv is never derived — .output would write an empty file")

print(f"checked {len(files)} rule files · {len(base)} base decls · {len(derived)} derived decls · {len(refs)} distinct relations")
for e in errors:
    print("  " + e)
sys.exit(1 if errors else 0)
