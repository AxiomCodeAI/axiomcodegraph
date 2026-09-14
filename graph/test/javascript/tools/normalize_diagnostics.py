#!/usr/bin/env python3
"""
Normalize the engine's DECLARED blind spots into a stable golden, beside the edges:

  parse_gap        <file>:<line>:<col>  <kind>  recoverable=<bool>  about=<relation>
  module_partial   <file>  <kind>
  import_cause     <file>:<line>:<col>  <specifier>  <cause>
  partial_site     <file>:<line>:<col>  <calleeText>  <kind>
  unresolved       <file>:<line>:<col>  <callKind> <calleeName>  <reason>
  package_entry    <package>  <subpath>  [<condition>]  <source>  <target>  <outcome>  -> <file>

The edges golden says what resolved; this says what the engine REFUSED and why, so
a rule change that turns a declared gap into a silent nothing fails here (#617). A
package's entries are pinned so a library staged on its own states what it exposes
(#616). Hashes never appear: they are run-local.

Usage: normalize_diagnostics.py <ir-dir> <engine-out-dir> [<lib-ir-dir>]
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


def raw(path, width):
    if not os.path.exists(path):
        return []
    with open(path) as fh:
        return [f for f in (l.rstrip('\n').split('\t') for l in fh) if len(f) >= width]


ir, out = sys.argv[1], sys.argv[2]
lib = sys.argv[3] if len(sys.argv) > 3 else None

modfile = {}
for d, tag in ((ir, ''), (lib, 'lib:')):
    if d is None:
        continue
    h, mods = read(os.path.join(d, 'all-javascript-modules.csv'))
    if h:
        for r in mods:
            modfile[r[h.index('jsModuleUniqueHash')]] = tag + r[h.index('filePath')]

h, sites = read(os.path.join(ir, 'all-javascript-call-sites.csv'))
site = {}
if h:
    i = {c: h.index(c) for c in ('expressionLinkHash', 'ownerModuleLinkHash', 'startLine', 'startColumn', 'callKind', 'calleeText')}
    for r in sites:
        site[r[i['expressionLinkHash']]] = (
            '%s:%s:%s' % (modfile.get(r[i['ownerModuleLinkHash']], '?'), r[i['startLine']], r[i['startColumn']]),
            r[i['callKind']], r[i['calleeText']].replace('\n', ' ')[:60])

h, imports = read(os.path.join(ir, 'all-javascript-imports.csv'))
imp = {}
if h:
    i = {c: h.index(c) for c in ('jsImportUniqueHash', 'ownerModuleLinkHash', 'startLine', 'startColumn', 'specifier')}
    for r in imports:
        imp[r[i['jsImportUniqueHash']]] = ('%s:%s:%s' % (modfile.get(r[i['ownerModuleLinkHash']], '?'), r[i['startLine']], r[i['startColumn']]), r[i['specifier']])

lines = set()
# parse_gap(Prov, Kind, Module, Line, Col, Recoverable, RelatedRelation, RelatedHash, GapHash)
for f in raw(os.path.join(out, 'parse-gap.csv'), 9):
    if f[0] != 'client':
        continue
    lines.add('parse_gap        %s:%s:%s  %s  recoverable=%s  about=%s' % (modfile.get(f[2], '?'), f[3], f[4], f[1], f[5], f[6]))
for f in raw(os.path.join(out, 'module-partial.csv'), 3):
    if f[0] == 'client':
        lines.add('module_partial   %s  %s' % (modfile.get(f[1], '?'), f[2]))
for f in raw(os.path.join(out, 'import-unresolved-cause.csv'), 2):
    pos, spec = imp.get(f[0], ('?', '?'))
    lines.add('import_cause     %s  %s  %s' % (pos, spec, f[1]))
for f in raw(os.path.join(out, 'site-in-partial-module.csv'), 2):
    pos, _, text = site.get(f[0], ('?', '?', '?'))
    lines.add('partial_site     %s  %s  %s' % (pos, text, f[1]))
# unresolved_receiver(CallExpr, CalleeName, Kind, Reason)
for f in raw(os.path.join(out, 'unresolved-receiver.csv'), 4):
    pos, kind, _ = site.get(f[0], ('?', f[2], '?'))
    lines.add('unresolved       %s  %s %s  %s' % (pos, kind, f[1], f[3]))
# package_entry(Prov, Package, Subpath, Condition, Source, Target, Outcome, ModuleHash)
for f in raw(os.path.join(out, 'package-entry.csv'), 8):
    lines.add('package_entry    %s  %s  [%s]  %s  %s  %s  -> %s' % (
        f[1], f[2], f[3], f[4], f[5], f[6], modfile.get(f[7], '-') if f[7] else '-'))
for l in sorted(lines):
    print(l)
