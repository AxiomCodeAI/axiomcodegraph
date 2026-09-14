#!/usr/bin/env python3
"""
The comparison ledger: one locked denominator, many tools, no tool graded on its own
idea of what exists.

── WHY A DATABASE AND NOT A SCRIPT THAT PRINTS A NUMBER ─────────────────────
One project has produced several different "accuracy" figures without the engine changing
at all. The differences were entirely in how sites were counted: a declaration identified
by basename rather than full path, and a target that was never staged scored as WRONG
rather than as unadjudicable. A number computed that way is not comparable with itself
across two runs, let alone with another tool.

So the universe is loaded ONCE, from the compiler, before any tool is read. Every tool is
then scored against those exact rows. A tool cannot add a site, cannot remove one, and
cannot be credited for a site the compiler never found.

── THE METRICS, AND WHY ALL FOUR ───────────────────────────────────────────
Ground truth is exactly ONE declaration per adjudicable site. A tool answers with a SET.

  coverage             answered / adjudicable        punishes refusing to answer
  recall               truth in set / adjudicable    punishes missing it; a SUPERSET COUNTS
  precision(answered)  truth in set / answered       punishes wrong answers only
  exactness            set == {truth} / adjudicable  punishes fans as well as wrong answers
  edge precision       TP / (TP + FP), FP = |set|-1  punishes fans, per surplus target

Reporting any one of these alone flatters a particular design. A tool that answers only
the easy sites scores high precision-of-answered and low coverage; a tool that returns a
wide set scores high recall and low edge precision. Both numbers are true and neither is
the whole story, so this prints them together and refuses to reduce them to one.

── THE DENOMINATOR IS DELIBERATELY STRICTER THAN three-way.py's ────────────
Adjudicable here means the compiler named a real declaration — nothing else is excluded.
three-way.py additionally drops sites whose target was never STAGED, because it is asking
a different question: how good are this engine's RULES, given what it was handed. That is
the right denominator for tuning a rule and the wrong one for comparing tools, because a
tool could then shrink its own denominator by staging less and score better for it. So the
two disagree on purpose and by a wide margin. Neither is wrong; quoting one where the
other applies is.

── NEUTRALITY IS ENFORCED BY THE UNMAPPED COUNT ────────────────────────────
Another tool names declarations in its own vocabulary. Mapping those onto full-path
declarations is exactly where a comparison quietly becomes unfair — a lenient mapping
credits answers that were never given, a strict one discards correct ones. So every load
reports how many of a tool's rows FAILED to map, and that count is printed beside its
scores. A tool whose rows mostly fail to map has not been measured, whatever its numbers
say.

── GRANULARITY, AND WHY IT IS AN OPTION RATHER THAN AN ASSUMPTION ──────────
Not every tool can answer at the same precision, and grading a coarse tool with a fine
ruler is a way of underreporting it rather than measuring it.

  decl  (file, line, column) — a specific DECLARATION. Separates overloads.
  line  (file, line)         — the declaration's LINE only.

A graph built from names and lines cannot answer at `decl`: without a column or a
signature its overloads collapse onto one node by construction. Reporting such a tool at
`decl` would score its design rather than its accuracy.

`line` is therefore the level at which such tools are comparable with this one, and the folding is applied
to GROUND TRUTH and to every tool alike — including ours, which loses its overload
precision in that view and should. The `decl` view stays available for tools that support
it, and a number from one view must never be quoted against the other.

── THE DATABASE IS NEVER COMMITTED ─────────────────────────────────────────
It lives in the IR store beside the extracted IR, not in the repository. This file is
tooling and belongs in git; its output does not.

Usage:
  ledger.py init            <db>
  ledger.py load-universe   <db> --project P --eval DIR
  ledger.py load-tool       <db> --project P --tool NAME --eval DIR          (this engine)
  ledger.py load-tool       <db> --project P --tool NAME --edges FILE [--root DIR]
  ledger.py report          <db> [--project P] [--granularity decl|line]
"""
import argparse
import csv
csv.field_size_limit(10**9)   # an IR literalValue can be a base64 asset; see test/tools/csv-limit-test.sh
import os
import re
import sqlite3
import sys
from collections import defaultdict

SYNTHETIC = {'synthesized', 'unresolved', 'oracle_error'}


def read_tsv(path, header=True):
    if not os.path.exists(path):
        return []
    with open(path, newline='', encoding='utf-8', errors='replace') as fh:
        # rfc4180, MATCHING SOUFFLE. The engine loads these same files with
        # `rfc4180=true`, so a string-literal type reaches a rule as `"close"` while a
        # QUOTE_NONE reader here sees the raw field `"""close"""`. Measured on three
        # projects: 6,193 values across 10 tables differ between the two readings,
        # including parameterTypeName, returnTypeName, ownerTypeName and completeTypeName.
        # Reading them differently on the two sides manufactures label mismatches that
        # look exactly like engine defects.
        rows = list(csv.reader(fh, delimiter='\t'))
    if header and rows:
        # A ROW THAT DOES NOT MEET THE HEADER'S FIELD COUNT IS DROPPED, not indexed into.
        # A torn write leaves a short row behind; reading it raises IndexError deep inside a
        # join and takes down a scorer that had nothing to do with the fault. The header is
        # the contract, and a row that breaks it is not data.
        n = len(rows[0])
        return [r for r in rows[1:] if len(r) == n]
    return rows


def source_root(d):
    p = os.path.join(d, '.source-root')
    if os.path.exists(p):
        r = open(p, encoding='utf-8').read().strip()
        if r:
            return r
    return None


def connect(db):
    con = sqlite3.connect(db)
    con.execute('PRAGMA foreign_keys=ON')
    return con


def cmd_init(a):
    con = connect(a.db)
    con.executescript('''
    CREATE TABLE IF NOT EXISTS site (
      site_id     INTEGER PRIMARY KEY,
      project     TEXT NOT NULL,
      file        TEXT NOT NULL,       -- relative to the analysed root
      s_line      INTEGER, s_col INTEGER, e_line INTEGER, e_col INTEGER,
      call_kind   TEXT,
      callee_name TEXT,
      -- the compiler's answer. NULL target => not adjudicable.
      target_path TEXT, target_line INTEGER, target_col INTEGER,
      target_kind TEXT,
      adjudicable INTEGER NOT NULL,
      UNIQUE(project, file, s_line, s_col, e_line, e_col)
    );
    CREATE TABLE IF NOT EXISTS answer (
      project TEXT NOT NULL, tool TEXT NOT NULL, site_id INTEGER NOT NULL,
      target_path TEXT, target_line INTEGER, target_col INTEGER,
      FOREIGN KEY(site_id) REFERENCES site(site_id)
    );
    CREATE TABLE IF NOT EXISTS tool_load (
      project TEXT NOT NULL, tool TEXT NOT NULL,
      rows_in INTEGER, rows_mapped INTEGER, rows_unmapped_site INTEGER,
      rows_out_of_universe INTEGER DEFAULT 0,
      PRIMARY KEY(project, tool)
    );
    CREATE INDEX IF NOT EXISTS answer_idx ON answer(project, tool, site_id);
    ''')
    con.commit()
    print(f'ledger ready: {a.db}')


def cmd_load_universe(a):
    """The denominator, from the compiler, before any tool is read."""
    con = connect(a.db)
    oracle = os.path.join(a.eval, 'oracle.tsv')
    rows = read_tsv(oracle)
    if not rows:
        print(f'no oracle at {oracle}', file=sys.stderr)
        return 2
    con.execute('DELETE FROM site WHERE project=?', (a.project,))
    n = adj = 0
    for r in rows:
        if len(r) < 12:
            continue
        n += 1
        tgt = None
        if r[11] not in SYNTHETIC and r[8]:
            tgt = (os.path.realpath(r[7]), int(r[8]), int(r[9]))
        adj += 1 if tgt else 0
        con.execute(
            'INSERT OR IGNORE INTO site(project,file,s_line,s_col,e_line,e_col,call_kind,'
            'callee_name,target_path,target_line,target_col,target_kind,adjudicable) '
            'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (a.project, r[0], int(r[1]), int(r[2]), int(r[3]), int(r[4]), r[5], r[6],
             tgt[0] if tgt else None, tgt[1] if tgt else None, tgt[2] if tgt else None,
             r[11], 1 if tgt else 0))
    con.commit()
    print(f'{a.project}: universe {n} sites, {adj} adjudicable — LOCKED')


def _engine_answers(evaldir):
    """This engine's answers, as (site-span-key) -> {(path,line,col)}."""
    ir = os.path.join(evaldir, 'ir')
    decl = {}

    def load(d):
        root = source_root(d)
        mods = {r[26]: r[3] for r in read_tsv(os.path.join(d, 'all-typescript-modules.csv'))}
        for r in read_tsv(os.path.join(d, 'all-typescript-methods.csv')):
            rel = r[4] or mods.get(r[21], '')
            path = os.path.realpath(os.path.join(root, rel)) if root else rel
            decl[r[42]] = (path, r[5], r[39])

    load(ir)
    libdir = os.path.join(evaldir, 'libir')
    if os.path.isdir(libdir):
        for d in sorted(os.listdir(libdir)):
            load(os.path.join(libdir, d))

    mod_file = {r[26]: r[3] for r in read_tsv(os.path.join(ir, 'all-typescript-modules.csv'))}
    span = {r[33]: (r[20], r[21], r[22], r[23])
            for r in read_tsv(os.path.join(ir, 'all-typescript-expressions.csv'))}
    key_of = {}
    for r in read_tsv(os.path.join(ir, 'all-typescript-call-sites.csv')):
        sp = span.get(r[5])
        if sp:
            key_of[r[5]] = (mod_file.get(r[6], ''), int(sp[0]), int(sp[1]), int(sp[2]), int(sp[3]))

    out = defaultdict(set)
    for r in read_tsv(os.path.join(evaldir, 'out', 'raw', 'call-chain-edges.csv'), header=False):
        if r[3] != '-' and r[3] in decl and r[0] in key_of:
            p, l, c = decl[r[3]]
            out[key_of[r[0]]].add((p, int(l), int(c)))
    return out


def _tsv_answers(path, root):
    """A generic tool export: callFile callLine callCol callEndLine callEndCol
    targetFile targetLine targetCol. Paths are made absolute against --root."""
    out = defaultdict(set)
    n = 0
    for r in read_tsv(path):
        if len(r) < 8:
            continue
        n += 1
        try:
            k = (r[0], int(r[1]), int(r[2]), int(r[3]), int(r[4]))
            t = (os.path.realpath(os.path.join(root, r[5])) if root else os.path.realpath(r[5]),
                 int(r[6]), int(r[7]))
        except ValueError:
            continue
        out[k].add(t)
    return out, n


# Relations that count as a CALL claim, following the discipline the Python-side adapter
# already settled on: be generous about what a rival CLAIMS, never invent claims for it.
#   calls / indirect_call / uses   the external graph asserting a call-like relationship
#   method / contains             pure containment — counting them would let it score on
#                                 structure it never claimed was a call
SLUG_GRAPH_CALL_RELATIONS = {'calls', 'indirect_call'}
SLUG_GRAPH_GENEROUS = SLUG_GRAPH_CALL_RELATIONS | {'uses'}


def _slug_graph_answers(path, relations):
    """a slug-graph graph.json -> (file, line) -> {(target file, target line)}.

    Its nodes are slugs carrying source_file and source_location as `L<n>`, the DEFINITION
    line; its links carry the relation plus the source_file/source_location of the SITE. So
    both ends are anchorable by line, and neither by column."""
    import json
    g = json.load(open(path, encoding='utf-8'))
    node = {}
    for n in g.get('nodes', []):
        loc = str(n.get('source_location', '') or '')
        m = re.match(r'L(\d+)', loc)
        if n.get('source_file') and m:
            node[n['id']] = (n['source_file'], int(m.group(1)))
    out = defaultdict(set)
    rows = 0
    for l in g.get('links', []):
        if l.get('relation') not in relations:
            continue
        loc = str(l.get('source_location', '') or '')
        m = re.match(r'L(\d+)', loc)
        tgt = node.get(l.get('target'))
        if not (l.get('source_file') and m and tgt):
            continue
        rows += 1
        out[(l['source_file'], int(m.group(1)))].add(tgt)
    return out, rows


def cmd_load_slug_graph(a):
    """A line-anchored tool. Its claim is 'a call on THIS LINE reaches THAT target', so it
    is credited at every ledger site starting on that line — generous, because the tool
    cannot distinguish them and penalising it for that would measure its design. The count
    of lines carrying more than one site is printed, so the generosity is auditable."""
    con = connect(a.db)
    by_line = defaultdict(list)
    root = None
    for sid, f, sl in con.execute(
            'SELECT site_id,file,s_line FROM site WHERE project=?', (a.project,)):
        by_line[(f, sl)].append(sid)
    if not by_line:
        print(f'{a.project}: no locked universe — run load-universe first', file=sys.stderr)
        return 2
    rel = SLUG_GRAPH_GENEROUS if a.generous else SLUG_GRAPH_CALL_RELATIONS
    answers, rows_in = _slug_graph_answers(a.graph, rel)
    con.execute('DELETE FROM answer WHERE project=? AND tool=?', (a.project, a.tool))
    mapped = unmapped = outside = 0
    shared = sum(1 for v in by_line.values() if len(v) > 1)
    # THE FILES THE COMPILER WAS NEVER ASKED ABOUT. A tool that also analyses `.js` and
    # `.mjs` will report call sites in files the TypeScript program does not include, so
    # tsc produced no ground truth for them and nobody can be right or wrong there.
    # Scoring those as misses would report a tool analysing MORE code than we asked about
    # as a failure, which is the precise way a comparison underreports a rival. Same
    # treatment as an unstaged target: outside the locked universe, therefore
    # unadjudicable for everyone, and counted apart.
    universe_files = {f for (f, _) in by_line}
    for (f, line), targets in answers.items():
        if f not in universe_files:
            outside += len(targets)
            continue
        sids = by_line.get((f, line))
        if not sids:
            unmapped += len(targets)
            continue
        for sid in sids:
            for (tf, tl) in targets:
                tp = os.path.realpath(os.path.join(a.root, tf)) if a.root else os.path.realpath(tf)
                con.execute('INSERT INTO answer VALUES(?,?,?,?,?,?)',
                            (a.project, a.tool, sid, tp, tl, 0))
                mapped += 1
    con.execute('INSERT OR REPLACE INTO tool_load VALUES(?,?,?,?,?,?)',
                (a.project, a.tool, rows_in, mapped, unmapped, outside))
    con.commit()
    pct = 100 * unmapped / max(mapped + unmapped, 1)
    print(f'{a.project}/{a.tool}: relations={sorted(rel)}  {mapped} mapped, '
          f'{unmapped} in-universe unmatched ({pct:.1f}%), {outside} outside the '
          f'compiler\'s program (not scored), {shared} lines carry >1 call site')
    if pct > 5:
        print('   << a tool whose rows do not map has not been measured')


def cmd_load_tool(a):
    con = connect(a.db)
    sites = {}
    for sid, f, sl, sc, el, ec in con.execute(
            'SELECT site_id,file,s_line,s_col,e_line,e_col FROM site WHERE project=?', (a.project,)):
        sites[(f, sl, sc, el, ec)] = sid
    if not sites:
        print(f'{a.project}: no locked universe — run load-universe first', file=sys.stderr)
        return 2

    if a.eval:
        answers = _engine_answers(a.eval)
        rows_in = sum(len(v) for v in answers.values())
    else:
        answers, rows_in = _tsv_answers(a.edges, a.root)
        rows_in = rows_in or sum(len(v) for v in answers.values())

    con.execute('DELETE FROM answer WHERE project=? AND tool=?', (a.project, a.tool))
    mapped = unmapped = outside = 0
    universe_files = {k[0] for k in sites}
    for k, targets in answers.items():
        sid = sites.get(k)
        if sid is None:
            # A file the compiler was never asked about is unadjudicable for everyone;
            # only an unmatched site INSIDE the program is a miss.
            if k[0] not in universe_files:
                outside += len(targets)
            else:
                unmapped += len(targets)
            continue
        for (p, l, c) in targets:
            con.execute('INSERT INTO answer VALUES(?,?,?,?,?,?)', (a.project, a.tool, sid, p, l, c))
            mapped += 1
    con.execute('INSERT OR REPLACE INTO tool_load VALUES(?,?,?,?,?,?)',
                (a.project, a.tool, rows_in, mapped, unmapped, outside))
    con.commit()
    pct = 100 * unmapped / max(mapped + unmapped, 1)
    print(f'{a.project}/{a.tool}: {mapped} mapped, {unmapped} in-universe unmatched '
          f'({pct:.1f}%), {outside} outside the compiler\'s program (not scored)'
          + ('   << a tool whose in-universe rows do not map has not been measured'
             if pct > 5 else ''))


def cmd_report(a):
    con = connect(a.db)
    # The fold. At `line` granularity a target is identified by its file and line only,
    # which is the finest thing a name-slug graph can express.
    fold = (lambda t: (t[0], t[1])) if a.granularity == 'line' else (lambda t: t)
    projects = [a.project] if a.project else [
        r[0] for r in con.execute('SELECT DISTINCT project FROM site ORDER BY project')]
    tools = [r[0] for r in con.execute('SELECT DISTINCT tool FROM answer ORDER BY tool')]
    if not tools:
        print('no tool answers loaded')
        return 0

    print(f'granularity: {a.granularity}')
    print(f'{"project":<10} {"tool":<12} {"adjud":>6} {"cover":>6} {"recall":>7} '
          f'{"prec(ans)":>10} {"exact":>7} {"edgeP":>7} {"unmapped":>9}')
    grand = defaultdict(lambda: defaultdict(int))
    for proj in projects:
        for tool in tools:
            adj = ans = rec = ex = tp = fp = 0
            for sid, tp_, tl, tc in con.execute(
                    'SELECT site_id,target_path,target_line,target_col FROM site '
                    'WHERE project=? AND adjudicable=1', (proj,)):
                adj += 1
                got = {fold(r) for r in con.execute(
                    'SELECT target_path,target_line,target_col FROM answer '
                    'WHERE project=? AND tool=? AND site_id=?', (proj, tool, sid))}
                if not got:
                    continue
                ans += 1
                truth = fold((tp_, tl, tc))
                if truth in got:
                    rec += 1
                    tp += 1
                    fp += len(got) - 1
                    if len(got) == 1:
                        ex += 1
                else:
                    fp += len(got)
            if not adj:
                continue
            # A TOOL THAT WAS NEVER RUN IS NOT A TOOL THAT SCORED ZERO. Printing 0.000 for
            # a project a tool has no rows for reads as a catastrophic result and is simply
            # absence of data — the single most misleading thing this report could do, and
            # the exact way a comparison underreports a rival.
            loaded = con.execute('SELECT 1 FROM tool_load WHERE project=? AND tool=?',
                                 (proj, tool)).fetchone()
            if not loaded:
                print(f'{proj:<10} {tool:<12} {adj:>6}   —  not run on this project —')
                continue
            # ANSWERED, BUT NOWHERE THE COMPILER COULD ADJUDICATE. A project can be mostly
            # synthesized sites — implicit constructors the compiler resolves and has no
            # declaration to point at — and a tool's rows can land entirely in that region.
            # A bare 0.000 is arithmetically right and reads as a catastrophe, so it is
            # labelled rather than left to be misread.
            any_rows = con.execute('SELECT rows_mapped FROM tool_load WHERE project=? '
                                   'AND tool=?', (proj, tool)).fetchone()
            if any_rows and any_rows[0] and not any(
                    con.execute('SELECT 1 FROM answer a JOIN site s ON s.site_id=a.site_id '
                                'WHERE a.project=? AND a.tool=? AND s.adjudicable=1 LIMIT 1',
                                (proj, tool))):
                print(f'{proj:<10} {tool:<12} {adj:>6}   —  {any_rows[0]} answers, none on '
                      f'an adjudicable site —')
                continue
            row = con.execute('SELECT rows_unmapped_site FROM tool_load '
                              'WHERE project=? AND tool=?', (proj, tool)).fetchone()
            um = row[0] if row else 0
            print(f'{proj:<10} {tool:<12} {adj:>6} {ans/adj:>6.3f} {rec/adj:>7.3f} '
                  f'{(rec/ans if ans else 0):>10.3f} {ex/adj:>7.3f} '
                  f'{(tp/(tp+fp) if tp+fp else 0):>7.3f} {um:>9}')
            g = grand[tool]
            g['adj'] += adj; g['ans'] += ans; g['rec'] += rec; g['ex'] += ex
            g['tp'] += tp; g['fp'] += fp; g['um'] += um
    print()
    for tool, g in sorted(grand.items()):
        adj = g['adj'] or 1
        print(f'{"ALL":<10} {tool:<12} {g["adj"]:>6} {g["ans"]/adj:>6.3f} {g["rec"]/adj:>7.3f} '
              f'{(g["rec"]/g["ans"] if g["ans"] else 0):>10.3f} {g["ex"]/adj:>7.3f} '
              f'{(g["tp"]/(g["tp"]+g["fp"]) if g["tp"]+g["fp"] else 0):>7.3f} {g["um"]:>9}')
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('init'); p.add_argument('db'); p.set_defaults(fn=cmd_init)
    p = sub.add_parser('load-universe'); p.add_argument('db')
    p.add_argument('--project', required=True); p.add_argument('--eval', required=True)
    p.set_defaults(fn=cmd_load_universe)
    p = sub.add_parser('load-tool'); p.add_argument('db')
    p.add_argument('--project', required=True); p.add_argument('--tool', required=True)
    p.add_argument('--eval'); p.add_argument('--edges'); p.add_argument('--root')
    p.set_defaults(fn=cmd_load_tool)
    p = sub.add_parser('load-slug-graph'); p.add_argument('db')
    p.add_argument('--project', required=True); p.add_argument('--tool', default='slug-graph')
    p.add_argument('--graph', required=True); p.add_argument('--root')
    p.add_argument('--generous', action='store_true',
                   help='also count the `uses` relation, which carries constructions its '
                        'own `calls` relation misses. Both figures should be reported.')
    p.set_defaults(fn=cmd_load_slug_graph)
    p = sub.add_parser('report'); p.add_argument('db'); p.add_argument('--project')
    p.add_argument('--granularity', choices=['decl', 'line'], default='decl',
                   help='decl = a specific declaration; line = its file and line only, '
                        'which is the finest level a name-slug graph can express')
    p.set_defaults(fn=cmd_report)
    a = ap.parse_args()
    if a.cmd == 'load-tool' and not (a.eval or a.edges):
        ap.error('load-tool needs --eval (this engine) or --edges (a tool export)')
    sys.exit(a.fn(a) or 0)


if __name__ == '__main__':
    main()
