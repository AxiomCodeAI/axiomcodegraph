#!/usr/bin/env python3
"""Expected answers for the queries/ suite (SPEC 6.4), derived from the oracle's rows.tsv only.

  query_oracle.py <oracle rows.tsv> <questions.tsv> <out-dir>

Writes <out-dir>/<qid>.tsv: '#' header lines (grade, section, role, fields, ask) then one tuple per line
(tab-separated values of `fields`; ORDER and CHAIN keep their order, SET sorts). `at` is "file:line" for a
node with a position, the bare repo-relative file for a page, stylesheet or resource.
A derivation that yields 0 tuples is written anyway and the runner fails it (a 0/0 is not a pass), except
TOP-k / CHAIN, whose expectation is an endpoint, not a set.
A LINK question (SPEC 11.2, Q36) is derived from a second oracle run with its include asserted
(--link-rows=<dir> holding link-<qid>/rows.tsv; run-tests.sh makes it from the derive's `<fragment>@<host>:<line>`).
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


def display_of(R, key):
    r = R.elem[key]
    cls = sorted(r[3].split()) if r[3] != '-' else []
    return '.'.join([r[1]] + cls[:3])


def esc(v):
    return str(v).replace('\\', '\\\\').replace('\t', '\\t').replace('\r', '\\r').replace('\n', '\\n')


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
        kinds = {'EVENT_ATTRIBUTE': {'on_attribute'}, 'TEMPLATE_EVENT': {'vue', 'alpine', 'angular', 'angularjs', 'svelte', 'htmx', 'stimulus'}}.get(src, {src})
        return sorted({(at_of(r[0]), r[2]) for r in R.by['handler'] if R.page_of(r[0]) == page and r[5] in kinds}), False
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
            if R.page_of(r[0]) == page and r[2] == 'external' and r[6] == '-':
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
    # ── iter2: SPEC 9 / 10 templates ──
    if fn in ('component_occurrences', 'component_slots'):
        disp = a[0]
        for r in R.by['component']:
            if r[0] != 'exact':
                continue
            keys = r[1].split(',')
            if display_of(R, keys[0]) == disp:
                if fn == 'component_occurrences':
                    return sorted({(at_of(k),) for k in keys}), False
                return sorted({(x[2], x[3], x[4]) for x in R.by['component_slot'] if x[0] == 'exact' and x[1] == keys[0]}), False
        raise SystemExit(f'query_oracle: no exact component displayed {disp}')
    if fn == 'page_components':
        out = set()
        for r in R.by['component']:
            keys = r[1].split(',')
            if any(R.page_of(k) == a[0] for k in keys):
                out.add((display_of(R, keys[0]),))
        return sorted(out), False
    if fn == 'computed_winners':
        e = R.elem_at(a[0])
        return sorted({(r[2], at_of(r[3])) for r in R.by['computed'] if r[0] == e and r[1] == '-' and r[3] != '-'}), False
    if fn == 'cascade_losers':
        e = R.elem_at(a[0])
        return sorted({(at_of(r[3]), r[5]) for r in R.by['cascade_entry'] if r[0] == e and r[1] == '-' and r[4] == 'lost'}), False
    if fn == 'token_uses':
        import re as _re
        val = a[0].lower()
        decls = [r for r in R.by['declaration'] if val in r[3].lower().replace(' ', '')]
        return sorted({(at_of(r[0]),) for r in decls}), False
    if fn == 'top_tokens':
        toks = sorted((r for r in R.by['token'] if r[0] == a[0]), key=lambda r: (-int(r[3]), r[1]))[:5]
        return [(r[1],) for r in toks], True
    if fn == 'media_elements':
        page, media = a
        norm = lambda m: ' '.join(m.lower().split()).replace('( ', '(').replace(' )', ')').replace(': ', ':').replace(' :', ':')
        return sorted({(at_of(r[2]),) for r in R.by['cascade'] if r[0] == page and any(norm(c.strip()[len('@media '):]) == norm(media) for c in r[8].split('&&') if c.strip().startswith('@media'))}), False
    if fn == 'unlabelled':
        return sorted({(at_of(r[0]),) for r in R.by['form_control'] if R.page_of(r[0]) == a[0] and r[7] == 'none'}), False
    if fn == 'outline_order':
        rows = sorted((r for r in R.by['outline'] if r[0] == a[0]), key=lambda r: int(r[1]))
        return [(at_of(r[2]),) for r in rows], True
    if fn == 'lists':
        return sorted({(at_of(r[0]), r[3]) for r in R.by['repeat'] if R.page_of(r[0]) == a[0]}), False
    if fn == 'unmatched_usage':
        return sorted({(at_of(r[0]),) for r in R.by['usage'] if r[0].startswith(f'{a[0]}:') and r[1] == 'unmatched_static'}), False
    if fn == 'class_styled':
        return sorted({(r[0], r[5]) for r in R.by['class'] if r[0] == a[0]}), False
    if fn == 'scripts_in_order':
        rows = sorted((r for r in R.by['script'] if R.page_of(r[0]) == a[0]), key=lambda r: int(r[1]))
        bodies = {r[0]: r[3][1:] for r in R.by['script_body']}
        return [(at_of(r[0]), bodies.get(r[0], '')) for r in rows], True
    if fn == 'handlers_code':
        page, filt = a if len(a) == 2 else (a[0], '-')
        out = set()
        for r in R.by['handler']:
            if R.page_of(r[0]) != page:
                continue
            if filt == 'onclick' and not (r[5] == 'on_attribute' and r[2] == 'click'):
                continue
            if filt == 'click' and r[2] != 'click':
                continue
            out.add((at_of(r[0]), r[2], r[5], r[7][1:]))
        return sorted(out), False
    # SPEC 11.2 [iter3] fragment hosts
    if fn == 'asserted_styles':
        # LINK: the rows come from an oracle run with this question's include asserted (--assert-include); only the
        # fragment's elements (the asserted ones) are the answer
        frag, host, text = a[0].split('@', 1)[0], a[1], a[2]
        sels = {k for k, t in R.sel_text.items() if t == text}
        return sorted({(at_of(r[1]), r[3]) for r in R.by['host_styles'] if r[0] in sels and r[2] == host
                       and R.page_of(r[1]) == frag}), False
    if fn == 'included_by':
        return sorted({(at_of(r[5]),) for r in R.by['include'] if r[1] == a[0] and r[7] in ('match', 'asserted')
                       and r[2] not in ('jinja:import', 'jinja:extends')}), False
    if fn == 'includes':
        return sorted({(at_of(r[5]), r[1]) for r in R.by['include'] if r[0] == a[0] and r[7] in ('match', 'asserted')
                       and r[2] not in ('jinja:import', 'jinja:extends')}), False
    if fn == 'host_styled':
        sels = {k for k, t in R.sel_text.items() if t == a[0]}
        own = {(at_of(r[1]), '') for r in R.by['styles'] if r[0] in sels and r[2] != 'unknown'}
        return sorted(own | {(at_of(r[1]), r[2]) for r in R.by['host_styles'] if r[0] in sels and r[3] != 'unknown'}), False
    if fn == 'skipped_not_built':
        return [('skipped_not_built',)], True
    raise SystemExit(f'query_oracle: unknown derivation {fn}')


# The answer's rows a question grades (SPEC 6.3 grades a SET of the role; several questions share one role and one
# ask, so each selects its rows by the SPEC 3.3 key the engine prints on every styled_by row).
FILTERS = {'styled_by': 'exact_non_important', 'styled_by_conditions': 'has_conditions',
           'styled_by_state': 'state', 'styled_by_important': 'important', 'cascade_losers': 'lost',
           'asserted_styles': 'asserted'}


def main():
    pos = [x for x in sys.argv[1:] if not x.startswith('--')]
    link_dir = next((x.split('=', 1)[1] for x in sys.argv[1:] if x.startswith('--link-rows=')), None)
    rows_path, qpath, out = pos[:3]
    R = Rows(rows_path)
    os.makedirs(out, exist_ok=True)
    for line in open(qpath, encoding='utf-8'):
        if line.startswith('#') or not line.strip():
            continue
        qid, template, grade, section, role, fields, ask, deriv = line.rstrip('\n').split('\t')
        fn, _, arg = deriv.partition(' ')
        if grade == 'LINK':
            # rows of an oracle run with this question's asserted include (run-tests.sh: <link-rows>/link-<qid>/rows.tsv)
            lp = os.path.join(link_dir or '', f'link-{qid}', 'rows.tsv')
            if not link_dir or not os.path.isfile(lp):
                raise SystemExit(f'query_oracle: {qid} is a LINK question and {lp} is missing')
            tuples, _ordered = derive(Rows(lp), fn, arg)
        else:
            tuples, _ordered = derive(R, fn, arg)
        with open(os.path.join(out, f'{qid}.tsv'), 'w', encoding='utf-8') as f:
            filt = FILTERS.get(fn, '-')
            if fn == 'handlers_code' and '|' in arg:
                filt = arg.split('|')[1]
            f.write(f'# {qid}: {template}\n# grade={grade} section={section} role={role} fields={fields} filter={filt}\n# ask: {ask}\n')
            for t in tuples:
                line = '\t'.join(esc(x) for x in t)
                f.write(('\\' + line if line.startswith('#') else line) + '\n')  # a value starting with # is not a comment


if __name__ == '__main__':
    main()
