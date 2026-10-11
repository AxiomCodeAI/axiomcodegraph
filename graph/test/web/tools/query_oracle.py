#!/usr/bin/env python3
"""Expected answers for the queries/ suite (SPEC 6.4), derived from the oracle's rows.tsv only.

  query_oracle.py <oracle rows.tsv> <questions.tsv> <out-dir>

Writes <out-dir>/<qid>.tsv: '#' header lines (grade, section, role, fields, ask) then one tuple per line
(tab-separated values of `fields`; ORDER and CHAIN keep their order, SET sorts). `at` is "file:line" for a
node with a position, the bare repo-relative file for a page, stylesheet or resource.
A derivation that yields 0 tuples is written anyway and the runner fails it (a 0/0 is not a pass), except
TOP-k / LINK / CHAIN, whose expectation is an endpoint, not a set.
"""
import collections
import os
import sys


def unesc(v):
    return v.replace('\\t', '\t').replace('\\n', '\n').replace('\\\\', '\\')


def at_of(key):
    """element/rule/declaration key file:line:col -> file:line; selector <rule>/<i> -> the rule's file:line;
    style@<element> -> the <style> element's file:line; a bare file stays a file."""
    k = key
    if '/' in k and k.rsplit('/', 1)[1].isdigit():
        k = k.rsplit('/', 1)[0]
    if k.startswith('style@'):
        k = k[len('style@'):]
    parts = k.rsplit(':', 2)
    if len(parts) == 3 and parts[1].isdigit() and parts[2].isdigit():
        return f'{parts[0]}:{parts[1]}'
    return k


class Rows:
    def __init__(self, path):
        self.by = collections.defaultdict(list)
        for line in open(path, encoding='utf-8'):
            f = [unesc(x) for x in line.rstrip('\n').split('\t')]
            self.by[f[0]].append(f[1:])
        self.elem = {r[0]: r for r in self.by['element']}          # key -> key, tag, id, classes
        self.parent = {r[1]: r[0] for r in self.by['contains']}
        self.sel_text = {r[0]: r[1] for r in self.by['selector']}
        self.rule = {r[0]: r for r in self.by['rule']}              # key, kind, prelude, parent

    def elem_at(self, page_line):
        page, line = page_line.rsplit(':', 1)
        ks = [k for k in self.elem if k.startswith(f'{page}:{line}:')]
        if len(ks) != 1:
            raise SystemExit(f'query_oracle: {page_line} names {len(ks)} elements; pick a line with exactly one')
        return ks[0]

    def page_of(self, ekey):
        return ekey.rsplit(':', 2)[0]


def derive(R, fn, arg):
    a = arg.split('|') if arg else []
    if fn in ('styled_by', 'styled_by_conditions', 'styled_by_state', 'styled_by_important'):
        e = R.elem_at(a[0])
        casc = {(r[1], r[2]): r for r in R.by['cascade'] if r[2] == e}   # page sel elem so ro lr spec imp cond
        styl = {r[0]: r for r in R.by['styles'] if r[1] == e}            # sel elem status reason pseudo
        rows = []
        for (sel, _e), c in casc.items():
            so, ro, lr, spec, imp, cond = int(c[3]), int(c[4]), int(c[5]), c[6], int(c[7]), c[8]
            a_, b_, c_ = (int(x) for x in spec.split(','))
            st = styl.get(sel, [None, None, '-', '-', '-'])
            rows.append(dict(at=at_of(sel), key=(1 if imp else 0, lr, a_, b_, c_, so, ro), imp=imp, cond=cond, status=st[2], reason=st[3]))
        if fn == 'styled_by':
            # Q1: the exact, non-important rules, in cascade order (the other styled_by questions take the rest)
            return [(r['at'],) for r in sorted(rows, key=lambda r: r['key']) if r['status'] == 'match' and r['imp'] == 0], True
        if fn == 'styled_by_conditions':
            return sorted({(r['at'], r['cond']) for r in rows if r['cond'] != '-'}), False
        if fn == 'styled_by_state':
            return sorted({(r['at'],) for r in rows if r['status'] == 'conditional' and 'state:' in r['reason']}), False
        if fn == 'styled_by_important':
            return sorted({(r['at'],) for r in rows if r['imp'] > 0}), False
    if fn == 'loaded_by':
        return sorted({(r[0],) for r in R.by['loads_sheet'] if r[1] == a[0] and r[5] != 'unknown'}), False
    if fn == 'loads':
        rows = [r for r in R.by['loads_sheet'] if r[0] == a[0] and r[3] != '-']
        return [(at_of(r[1]),) for r in sorted(rows, key=lambda r: int(r[3]))], True
    if fn == 'carries_class':
        return sorted({(at_of(r[0]),) for r in R.by['class_token'] if r[2] == a[0]}), False
    if fn == 'rules_class':
        return sorted({(at_of(r[0]),) for r in R.by['selector_part'] if r[1] == 'CLASS' and r[2] == a[0]}), False
    if fn == 'styled_by_selector':
        page, text = a
        sels = {k for k, t in R.sel_text.items() if t == text}
        return sorted({(at_of(r[1]),) for r in R.by['styles'] if r[0] in sels and R.page_of(r[1]) == page}), False
    if fn == 'unmatched':
        sheet = a[0]
        matched = {r[0] for r in R.by['styles'] if r[2] != 'unknown'}
        rules = [k for k, r in R.rule.items() if k.startswith(f'{sheet}:') and r[1] == 'style']
        out = set()
        for rk in rules:
            sels = [s for s in R.sel_text if s.startswith(f'{rk}/')]
            for s in sels:
                if s not in matched:
                    out.add((at_of(s),))
        return sorted(out), False
    if fn == 'var_defines':
        return sorted({(at_of(r[0]),) for r in R.by['declaration'] if r[2] == a[0]}), False
    if fn == 'var_uses':
        return sorted({(at_of(r[0]),) for r in R.by['value_ref'] if r[1] == 'VARIABLE' and r[2] == a[0]}), False
    if fn == 'var_affects':
        page, name = a
        owners = {r[0] for r in R.by['value_ref'] if r[1] == 'VARIABLE' and r[2] == name}
        rules = {r[1] for r in R.by['declaration'] if r[0] in owners}
        sels = {s for s in R.sel_text if s.rsplit('/', 1)[0] in rules}
        return sorted({(at_of(r[1]),) for r in R.by['styles'] if r[0] in sels and R.page_of(r[1]) == page and r[2] == 'match'}), False
    if fn == 'keyframes_defines':
        return sorted({(at_of(r[0]),) for r in R.by['keyframes'] if r[1] == a[0]}), False
    if fn == 'keyframes_uses':
        return sorted({(at_of(r[0]),) for r in R.by['value_ref'] if r[1] == 'KEYFRAMES' and r[2] == a[0]}), False
    if fn == 'font_defines':
        return sorted({(at_of(r[0]),) for r in R.by['font_face'] if r[1].lower() == a[0].lower()}), False
    if fn == 'font_uses':
        return sorted({(at_of(r[0]),) for r in R.by['value_ref'] if r[1] == 'FONT_FAMILY' and r[2].lower() == a[0].lower()}), False
    if fn == 'handlers':
        page, src = a
        return sorted({(at_of(r[0]), r[3]) for r in R.by['event_handler'] if R.page_of(r[0]) == page and r[2] == src}), False
    if fn == 'linked_from':
        return sorted({(at_of(r[0]),) for r in R.by['links_to'] if r[2] == a[0] and r[4] != 'unknown'}), False
    if fn == 'chain_links':
        edges = {(R.page_of(r[0]), r[2]) for r in R.by['links_to'] if r[4] != 'unknown'}
        return [('endpoints', a[0], a[1])] + sorted(('edge', x, y) for x, y in edges), True
    if fn == 'chain_loads':
        edges = {(r[0], r[1]) for r in R.by['loads_sheet'] if r[2] == 'link' and r[5] != 'unknown'}
        edges |= {(r[0], r[1]) for r in R.by['imports'] if r[2] == 'match'}
        return [('endpoints', a[0], a[1])] + sorted(('edge', x, y) for x, y in edges), True
    if fn == 'inline_style':
        return sorted({(at_of(r[1][len('attr@'):]), r[2]) for r in R.by['declaration'] if r[1].startswith(f'attr@{a[0]}:')}), False
    if fn == 'unresolved':
        page = a[0]
        refs = {(r[2]): r for r in R.by['reference'] if R.page_of(r[0]) == page}
        out = set()
        for r in R.by['loads_sheet']:
            if r[0] == page and r[5] == 'unknown' and r[1] in refs:
                out.add((at_of(refs[r[1]][0]), r[6]))
        for r in R.by['script']:
            if R.page_of(r[0]) == page and r[1] == 'EXTERNAL' and r[3] == '-':
                ref = next((x for x in R.by['reference'] if x[0] == r[0] and x[1] == 'src'), None)
                if ref:
                    out.add((at_of(r[0]), 'external_url' if ref[3] == 'external' else 'unresolved_url'))
        return sorted(out), False
    if fn == 'orphans':
        return sorted({(r[1],) for r in R.by['unknown'] if r[0] == 'orphan_sheet'}), False
    if fn == 'id_carriers':
        page, idv = a
        return sorted({(at_of(k),) for k, r in R.elem.items() if R.page_of(k) == page and r[2] == idv}), False
    if fn == 'id_referrers':
        page, idv = a
        return sorted({(at_of(r[0]),) for r in R.by['id_ref'] if R.page_of(r[0]) == page and r[2] == idv}), False
    if fn == 'css_resources':
        return sorted({(r[4],) for r in R.by['value_ref'] if r[0].startswith(f'{a[0]}:') and r[1] == 'URL' and r[4] != '-'}), False
    if fn == 'inert':
        out = set()
        for k in R.elem:
            if R.page_of(k) != a[0]:
                continue
            p = R.parent.get(k)
            while p and p in R.elem:
                if R.elem[p][1] in ('template', 'noscript'):
                    out.add((at_of(k),)); break
                p = R.parent.get(p)
        return sorted(out), False
    if fn == 'forms':
        out = set()
        for k, r in R.elem.items():
            if R.page_of(k) != a[0] or r[1] != 'form':
                continue
            action = next((x[2] for x in R.by['attribute'] if x[0] == k and x[1] == 'action'), '-')
            names = []
            for c, p in R.parent.items():
                q = p
                while q and q != k:
                    q = R.parent.get(q)
                if q == k:
                    n = next((x[2] for x in R.by['attribute'] if x[0] == c and x[1] == 'name'), None)
                    if n:
                        names.append(n)
            out.add((at_of(k), action, ','.join(sorted(names))))
        return sorted(out), False
    if fn == 'link_resources':
        out = set()
        for r in R.by['reference']:
            if R.page_of(r[0]) == a[0] and R.elem[r[0]][1] == 'link' and r[4] != '-':
                rel = next((x[2] for x in R.by['attribute'] if x[0] == r[0] and x[1] == 'rel'), '')
                if 'stylesheet' not in rel.lower().split():
                    out.add((r[4],))
        return sorted(out), False
    if fn == 'sheet_most_rules':
        c = collections.Counter(at_of(r[0]).rsplit(':', 1)[0] for r in R.by['selector_part'] if r[1] == 'CLASS' and r[2] == a[0])
        return [(c.most_common(1)[0][0],)], True
    if fn == 'media_sheet':
        media = {k for k, r in R.rule.items() if r[1] == '@media'}
        sheets = {at_of(p[0]).rsplit(':', 1)[0] for p in R.by['selector_part']
                  if p[1] == 'CLASS' and p[2] == a[0] and R.rule.get(p[0].rsplit('/', 1)[0], [None] * 4)[3] in media}
        return sorted((s,) for s in sheets), True
    if fn == 'skipped_not_built':
        return [('skipped_not_built',)], True
    raise SystemExit(f'query_oracle: unknown derivation {fn}')


# The answer's rows a question grades (SPEC 6.3 grades a SET of the role; several questions share one role and one
# ask, so each selects its rows by the SPEC 3.3 key the engine prints on every styled_by row).
FILTERS = {'styled_by': 'exact_non_important', 'styled_by_conditions': 'has_conditions',
           'styled_by_state': 'state', 'styled_by_important': 'important'}


def main():
    rows_path, qpath, out = sys.argv[1:4]
    R = Rows(rows_path)
    os.makedirs(out, exist_ok=True)
    for line in open(qpath, encoding='utf-8'):
        if line.startswith('#') or not line.strip():
            continue
        qid, template, grade, section, role, fields, ask, deriv = line.rstrip('\n').split('\t')
        fn, _, arg = deriv.partition(' ')
        tuples, _ordered = derive(R, fn, arg)
        with open(os.path.join(out, f'{qid}.tsv'), 'w', encoding='utf-8') as f:
            filt = FILTERS.get(fn, '-')
            f.write(f'# {qid}: {template}\n# grade={grade} section={section} role={role} fields={fields} filter={filt}\n# ask: {ask}\n')
            for t in tuples:
                f.write('\t'.join(t) + '\n')


if __name__ == '__main__':
    main()
