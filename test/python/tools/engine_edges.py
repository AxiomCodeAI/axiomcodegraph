#!/usr/bin/env python3
"""Fold the ENGINE's answer into the same shape as the oracle's.

SYMMETRY IS THE ENTIRE POINT OF THIS FILE. Every fold applied to the CPython side
-- decorators onto the `def` line, comprehension scopes into their parent, module
scope onto line 0, bound methods onto their function -- is applied here too, by
importing `callchain_oracle.normalize` rather than by reimplementing it. An
asymmetry between the two sides manufactures defects that look exactly like
engine bugs, and they are the most expensive kind to chase because the engine is
innocent.

Reads:
  <ir>/all-python-methods.csv     method hash -> filePath, startLine, methodKind
  <ir>/all-python-call-sites.csv  the call-site inventory the parser produced
  <out>/call-chain-edges.csv      the engine's edges, 7 columns:
                                    site, caller, calleeProv, callee, prov, status, kind

Emits, per --mode:
  pairs    caller-anchor <TAB> callee-anchor      (client -> client only)
  sites    file:line, one per call site the engine ACCOUNTED FOR (any status)
  golden   status <TAB> kind <TAB> caller -> callee, sorted -- the reviewable form
"""
import argparse
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oracle_path import harness_root                      # noqa: E402

harness_root()
from callchain_oracle.normalize import (Anchor, Normalizer,   # noqa: E402
                                        ir_anchor_line)

EDGES = 'call-chain-edges.csv'


def rows(path):
    if not os.path.exists(path):
        return []
    with open(path, newline='', encoding='utf-8', errors='replace') as fh:
        r = list(csv.reader(fh, delimiter='\t', quoting=csv.QUOTE_NONE))
    if not r:
        return []
    hdr = r[0]
    return [dict(zip(hdr, x + [''] * (len(hdr) - len(x)))) for x in r[1:]]


class IR:
    def __init__(self, ir_dir: str, src_root: str):
        self.norm = Normalizer(src_root)
        self.method_anchor = {}        # method hash -> Anchor
        self.method_label = {}         # method hash -> readable qualname
        for m in rows(os.path.join(ir_dir, 'all-python-methods.csv')):
            h = m.get('pyMethodUniqueHash')
            if not h:
                continue
            rel = (m.get('filePath') or '').replace(os.sep, '/')
            try:
                line = int(m.get('startLine') or 0)
            except ValueError:
                line = 0
            idx = self.norm.index(os.path.join(src_root, rel))
            # Rules 1 and 5, applied to the IR side exactly as to CPython's.
            line = ir_anchor_line(idx, line, m.get('methodKind', ''))
            a = Anchor(rel, line)
            self.method_anchor[h] = a
            self.method_label[h] = m.get('qualifiedName') or self.norm.qualname(a)

        # A DECORATOR APPLICATION IS A REAL CALL SITE. `@deco` invokes `deco(fn)`;
        # the author wrote it and CPython emits a CALL for it. The parser records
        # it in `all-python-decorators.csv` rather than in `all-python-call-sites.csv`,
        # so an inventory built from call sites alone reports it as a silent drop.
        #
        # MEASURED: counting call sites alone, CPython saw 15 sites in 02-methods
        # against the IR's 12, and 30 against 21 in 07-decorators. Adding the
        # decorator rows makes every line agree exactly in all 12 cases. The
        # shortfall was a representation difference, not a dropped site.
        #
        # An unmodelled decorator must therefore come out `ambiguous_unknown` --
        # never an edge, and never absent.
        self.site_pos = {}             # site/expression hash -> "file:line"
        for d in rows(os.path.join(ir_dir, 'all-python-decorators.csv')):
            rel = ''
            mh = d.get('pyMethodLinkHash')
            if mh in self.method_anchor:
                rel = self.method_anchor[mh].file
            try:
                line = int(d.get('startLine') or 0)
            except ValueError:
                line = 0
            for key in ('pyDecoratorUniqueHash', 'pyExpressionLinkHash'):
                if d.get(key):
                    self.site_pos[d[key]] = f'{rel}:{line}'
        for c in rows(os.path.join(ir_dir, 'all-python-call-sites.csv')):
            rel = ''
            mh = c.get('pyMethodLinkHash')
            if mh in self.method_anchor:
                rel = self.method_anchor[mh].file
            try:
                line = int(c.get('startLine') or 0)
            except ValueError:
                line = 0
            pos = f'{rel}:{line}'
            for key in ('pyCallSiteUniqueHash', 'pyExpressionLinkHash'):
                if c.get(key):
                    self.site_pos[c[key]] = pos

    def label(self, h):
        return self.method_label.get(h, h or '-')

    def anchor(self, h):
        return self.method_anchor.get(h)


def edge_rows(out_dir: str):
    path = os.path.join(out_dir, EDGES)
    if not os.path.exists(path):
        return None
    out = []
    with open(path, encoding='utf-8', errors='replace') as fh:
        for line in fh:
            f = line.rstrip('\n').split('\t')
            if len(f) < 7:
                continue
            out.append({'site': f[0], 'caller': f[1], 'callee': f[3],
                        'prov': f[4], 'status': f[5], 'kind': f[6]})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('ir')
    ap.add_argument('out')
    ap.add_argument('src')
    ap.add_argument('--mode', choices=('pairs', 'sites', 'golden'), default='golden')
    args = ap.parse_args()

    ir = IR(args.ir, args.src)
    edges = edge_rows(args.out)
    if edges is None:
        sys.stderr.write(f'no {EDGES} in {args.out} -- the engine produced no edge export\n')
        return 4

    if args.mode == 'sites':
        # A MULTISET, one line per SITE the engine accounted for, deliberately
        # NOT deduplicated. Two calls written on one source line are two sites,
        # and a deduplicated list would report an engine that emitted one of them
        # as fully conservative. The oracle compares per-line counts.
        out_lines = []
        counted = set()
        for e in edges:
            if e['site'] in counted:
                continue          # one edge per site; a site with several
                                  # candidate targets is still ONE site
            counted.add(e['site'])
            pos = ir.site_pos.get(e['site'])
            if pos:
                out_lines.append(pos)
        for s in sorted(out_lines):
            print(s)
        return 0

    if args.mode == 'pairs':
        # client -> client only. A callee the engine marked `lib`, or one that is
        # not a method of THIS project, is out of scope for this suite by design:
        # library linking is measured separately, so a regression here is never
        # ambiguous about which layer broke.
        seen = set()
        for e in edges:
            ca, ta = ir.anchor(e['caller']), ir.anchor(e['callee'])
            if ca is None or ta is None or e['prov'] != 'client':
                continue
            seen.add((ca.key(), ta.key()))
        for a, b in sorted(seen):
            print(f'{a}\t{b}')
        return 0

    # golden: the reviewable form. Unresolved sites are emitted with target `-`,
    # so the golden records DECLARED UNKNOWNS too -- losing resolution power and
    # silently gaining a blind spot must both show up as a diff.
    seen = set()
    for e in edges:
        callee = ir.label(e['callee']) if e['callee'] else '-'
        seen.add(f"{e['status']}\t{e['kind']}\t{ir.label(e['caller'])} -> {callee}")
    for s in sorted(seen):
        print(s)
    return 0


if __name__ == '__main__':
    sys.exit(main())
