#!/usr/bin/env python3
"""Normalize the config-resolution CSVs into a stable, reviewable golden.

The call-graph goldens (normalize_edges.py) say nothing about config: bean_def,
di_edge, config_binding, config_affects_method, config_entry_point, config_class_ref,
config_key_ref and config_unresolved are separate relations, so they need their own
golden or a change in them lands silently.

Every hash is resolved to a name and every absolute path to a basename, so the output
is reviewable and is not sensitive to hash churn or to where the repo is checked out.
Rows are grouped by relation and sorted inside each group.

DECLARED UNKNOWNS ARE PART OF THE GOLDEN. config_unresolved is printed like any other
section, so losing interpretation power and silently gaining a blind spot both show up
as a diff — the same contract normalize_edges.py applies to ambiguous_unknown.

usage: config_report.py <IR-dir> <OUT-dir>
"""
import csv, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalize_edges import Names, rows, simple


class Labels(Names):
    """Names, plus the entity kinds only config references: fields, parameters,
    XML elements/attributes and annotation uses."""

    def __init__(self, ir):
        super().__init__(ir)
        self.f, self.p, self.x, self.a = {}, {}, {}, {}
        for r in rows(f'{ir}/all-fields.csv'):
            owner = r.get('ownerQualifiedName') or r.get('ownerTypeName') or '?'
            self.f[r['fieldRegistryUniqueHash']] = f"{owner}#{r['name']}"
        for r in rows(f'{ir}/all-method-parameters.csv'):
            m = self.m.get(r['methodRegistryLinkHash'], '?')
            self.p[r['methodParameterUniqueHash']] = f"{m}:{r['paramName']}"
        for r in rows(f'{ir}/all-xml-elements.csv'):
            self.x[r['xmlElementUniqueHash']] = \
                f"{os.path.basename(r['filePath'])}:{r['startLine']} <{r['tagName']}>"
        for r in rows(f'{ir}/all-xml-attributes.csv'):
            self.x[r['xmlAttributeUniqueHash']] = \
                f"{os.path.basename(r['filePath'])}:{r['startLine']} @{r['name']}"
        for r in rows(f'{ir}/all-annotations.csv'):
            self.a[r['typeAnnotationUniqueHash']] = f"@{r['annotationName']}"

    def lbl(self, h):
        if h in ('-', ''):
            return h or '-'
        for d in (self.m, self.f, self.p, self.x, self.a):
            if h in d:
                return d[h]
        if h in self.types:
            return self.types[h]
        # not a hash at all: a config key, a bean name, a status word — print as-is
        return h


def load(out, name):
    p = f'{out}/{name}'
    if not os.path.exists(p):
        return []
    with open(p, newline='', encoding='utf-8', errors='replace') as fh:
        return [r for r in csv.reader(fh, delimiter='\t', quoting=csv.QUOTE_NONE) if r]


def main():
    ir, out = sys.argv[1], sys.argv[2]
    L = Labels(ir)

    # (relation file, section title, row -> golden line)
    SECTIONS = [
        ('config-bean-def.csv', 'bean_def',
         lambda r: f"{r[2]:<16} {r[0]:<22} <- {L.lbl(r[1])}"),
        ('config-inject-point.csv', 'inject_point',
         lambda r: f"{r[0]:<16} {L.lbl(r[1])} : {L.lbl(r[2])}"),
        ('config-di-edge.csv', 'di_edge',
         lambda r: f"{r[5]:<16} {r[1]:<16} {L.lbl(r[0])} : {L.lbl(r[2])} <- {r[3]} ({L.lbl(r[4])})"),
        ('config-class-ref.csv', 'config_class_ref',
         lambda r: f"{r[0]:<12} {L.lbl(r[1]):<34} \"{r[2]}\" -> {L.lbl(r[3])} [{r[4]}]"),
        ('config-key-ref.csv', 'config_key_ref',
         lambda r: f"{r[0]} -> {r[1]}" + (f"  (default \"{r[2]}\")" if len(r) > 2 and r[2] else "")),
        ('config-binding.csv', 'config_binding',
         lambda r: f"{r[0]:<26} {r[1]:<18} {r[2]:<8} {L.lbl(r[3])}"),
        ('config-affects-method.csv', 'config_affects_method',
         lambda r: f"{r[0]:<26} {r[2]:<16} {L.lbl(r[1])}"),
        ('config-entry-point.csv', 'config_entry_point',
         lambda r: f"{r[1]:<18} {L.lbl(r[0])}"),
        ('config-unresolved.csv', 'config_unresolved  [DECLARED UNKNOWNS]',
         lambda r: f"{r[3]:<26} {r[0]:<12} {L.lbl(r[1])}" + (f"  \"{r[2]}\"" if r[2] else "")),
    ]

    for fname, title, fmt in SECTIONS:
        data = load(out, fname)
        lines = sorted({fmt(r) for r in data})
        print(f"── {title} ({len(lines)}) ──")
        for l in lines:
            print(f"  {l}")


if __name__ == '__main__':
    main()
