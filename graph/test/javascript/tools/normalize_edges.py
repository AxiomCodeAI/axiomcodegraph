#!/usr/bin/env python3
"""
Normalize the engine's call-chain edges into a stable, human-readable golden:

  <file>:<line>:<col> <callKind> <calleeText>  ->  <status>  <targetFile>:<line>:<col> <targetName>

Per SITE (the position is part of the key) so three calls to one function from one
caller stay three lines, and a wrong target on one of them cannot hide behind the
other two. Hashes never appear: they are run-local.

Usage: normalize_edges.py <ir-dir> <engine-out-dir> [<lib-ir-dir>]
"""
import csv
csv.field_size_limit(10**9)
import os
import sys

def read(path):
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        return [], []
    with open(path, newline='') as fh:
        rows = list(csv.reader(fh, delimiter='\t'))
    h = rows[0]
    return h, [r for r in rows[1:] if len(r) == len(h)]

def methods(d, tag):
    h, rows = read(os.path.join(d, 'all-javascript-methods.csv'))
    if not h:
        return {}
    i = {c: h.index(c) for c in ('jsMethodUniqueHash', 'filePath', 'startLine', 'startColumn', 'name')}
    return {r[i['jsMethodUniqueHash']]: '%s%s:%s:%s %s' % (tag, r[i['filePath']], r[i['startLine']], r[i['startColumn']], r[i['name']]) for r in rows}

ir, out = sys.argv[1], sys.argv[2]
lib = sys.argv[3] if len(sys.argv) > 3 else None
m = methods(ir, '')
if lib:
    m.update(methods(lib, 'lib:'))
h, mods = read(os.path.join(ir, 'all-javascript-modules.csv'))
modfile = {r[h.index('jsModuleUniqueHash')]: r[h.index('filePath')] for r in mods} if h else {}
h, sites = read(os.path.join(ir, 'all-javascript-call-sites.csv'))
site = {}
if h:
    i = {c: h.index(c) for c in ('expressionLinkHash', 'ownerModuleLinkHash', 'startLine', 'startColumn', 'callKind', 'calleeText')}
    for r in sites:
        site[r[i['expressionLinkHash']]] = '%s:%s:%s %s %s' % (modfile.get(r[i['ownerModuleLinkHash']], '?'), r[i['startLine']], r[i['startColumn']], r[i['callKind']], r[i['calleeText']].replace('\n', ' ')[:60])
# An ACCESSOR edge (#731) is keyed on the PROPERTY_ACCESS expression, which is no call
# site, so its position comes from the expressions table. Written second so a real call
# site keeps the text the parser gave it.
access = {}
h, exprs = read(os.path.join(ir, 'all-javascript-expressions.csv'))
if h:
    i = {c: h.index(c) for c in ('jsExpressionUniqueHash', 'ownerModuleLinkHash', 'startLine', 'startColumn', 'expressionKind', 'text')}
    for r in exprs:
        if r[i['expressionKind']] in ('PROPERTY_ACCESS', 'OPTIONAL_ACCESS', 'ELEMENT_ACCESS'):
            access[r[i['jsExpressionUniqueHash']]] = '%s:%s:%s %%s %s' % (
                modfile.get(r[i['ownerModuleLinkHash']], '?'), r[i['startLine']], r[i['startColumn']],
                r[i['text']].replace('\n', ' ')[:60])
lines = set()
with open(os.path.join(out, 'call-chain-edges.csv')) as fh:
    for line in fh:
        f = line.rstrip('\n').split('\t')
        if len(f) < 7:
            continue
        ce, caller, _, callee, prov, cls, kind = f[:7]
        tgt = m.get(callee, '-') if callee != '-' else '-'
        # An accessor edge has no call site: its position comes from the expression and
        # the KIND (PROPERTY_READ / PROPERTY_WRITE) says which half of the protocol ran.
        where = site.get(ce) or (access[ce] % kind if ce in access else ce)
        lines.add('%s  ->  %s  %s' % (where, cls, tgt))
for l in sorted(lines):
    print(l)
