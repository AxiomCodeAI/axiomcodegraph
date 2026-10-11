#!/usr/bin/env python3
"""Grade one --json answer against one expected answer of the queries/ suite (SPEC 6.2 / 6.3).

  grade_query.py <answer.json> <expected Qn.tsv>        exit 0 correct, 1 wrong, 4 truncated (re-ask with --limit 0),
                                                        5 skipped (iteration-2 template, never counted correct)

The answer contract (SPEC 6.2): web rows are JSON objects carrying at least `at` ("file:line" or a file), `role`,
`status` and, for ordered sections, `rank`. Only the web graph's part of an answer is graded (HTML and CSS only;
other_languages is never read). Field aliases: event = event | event_name; names may be a list.
An expected `at` without a line compares the answer's file part only.
"""
import json
import sys

ALIASES = {'event': ['event', 'event_name'], 'code': ['code', 'body'], 'display': ['display', 'name'],
           'path': ['path'], 'kind': ['kind'], 'attr': ['attribute_name', 'attr'], 'name': ['name', 'class_name'],
           'styled': ['styled'], 'lost_reason': ['lost_reason'], 'source_kind': ['source_kind', 'source'], 'property': ['property', 'prop'], 'reason': ['reason'], 'conditions': ['conditions'],
           'action': ['action'], 'names': ['names', 'inputs']}


def walk(o, out):
    if isinstance(o, dict):
        if 'at' in o:
            out.append(o)
        for k, v in o.items():
            if k == 'other_languages':
                continue
            walk(v, out)
    elif isinstance(o, list):
        for v in o:
            walk(v, out)


def section_of(ans, section):
    if section != 'web':
        raise SystemExit(f'grade_query: section {section}: only the web graph is graded')
    return ans


def field(row, name):
    for k in ALIASES.get(name, [name]):
        if k in row:
            v = row[k]
            return ','.join(sorted(map(str, v))) if isinstance(v, list) else str(v)
    return None


def unesc(v):
    out, i = [], 0
    while i < len(v):
        if v[i] == '\\' and i + 1 < len(v):
            out.append({'n': '\n', 't': '\t', 'r': '\r', '\\': '\\'}.get(v[i + 1], v[i + 1])); i += 2
        else:
            out.append(v[i]); i += 1
    return ''.join(out)


def num(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def keep(row, filt):
    """The per-question row filter written by query_oracle.py (header `filter=`), over the SPEC 3.3 key fields."""
    status = row.get('status'); reason = str(row.get('reason') or '-'); cond = row.get('conditions')
    important = num(row.get('important_count', row.get('important')))
    if filt in ('-', None):
        return True
    if filt == 'exact_non_important':
        return status == 'match' and important == 0
    if filt == 'has_conditions':
        return cond not in (None, '', '-', [])
    if filt == 'state':
        return status == 'conditional' and any(x.startswith('state:') for x in reason.split(';'))
    if filt == 'important':
        return important > 0
    if filt == 'lost':
        return row.get('outcome') == 'lost'
    if filt == 'onclick':
        return str(row.get('source_kind') or row.get('source')) == 'on_attribute' and row.get('event') == 'click'
    if filt == 'click':
        return row.get('event') == 'click'
    raise SystemExit(f'grade_query: unknown filter {filt}')


def norm_at(a, want_line):
    a = str(a)
    return a if want_line else a.rsplit(':', 1)[0] if a.rsplit(':', 1)[-1].isdigit() else a


def main():
    ans_path, exp_path = sys.argv[1:3]
    head = {}
    exp = []
    for line in open(exp_path, encoding='utf-8'):
        line = line.rstrip('\n')
        if line.startswith('# grade='):
            head = dict(kv.split('=', 1) for kv in line[2:].split())
        elif line and not line.startswith('#'):
            exp.append(tuple(unesc(x) for x in line.split('\t')))
    grade, section, role, fields = head['grade'], head['section'], head['role'], head['fields'].split(',')
    if exp == [('skipped_not_built',)]:
        print('  skipped_not_built (iteration-2 template)')
        return 5
    try:
        ans = json.load(open(ans_path, encoding='utf-8'))
    except (OSError, ValueError) as e:
        print(f'  answer is not JSON: {e}')
        return 1
    if isinstance(ans, dict) and any(isinstance(v, int) and v > 0 for k, v in ans.items() if k == 'more'):
        return 4
    rows = []
    walk(section_of(ans, section), rows)
    if any(isinstance(r.get('more'), int) and r['more'] > 0 for r in rows):
        return 4
    want_line = bool(exp) and grade not in ('CHAIN', 'TOP-k') and 'at' in fields and ':' in exp[0][fields.index('at')] and exp[0][fields.index('at')].rsplit(':', 1)[1].isdigit()

    if grade == 'TOP-k':
        places = []
        for r in rows:
            f = norm_at(r.get('at') or r.get('file') or '', False) if (r.get('at') or r.get('file')) else str(r.get('value') or '')
            if f and f not in places:
                places.append(f)
        top = places[:10]
        missing = [e[0] for e in exp if e[0] not in top]
        print(f'  top-10 places: {top}')
        return 0 if exp and not missing else 1

    if grade == 'CHAIN':
        start, end = exp[0][1], exp[0][2]
        edges = {(e[1], e[2]) for e in exp[1:]}
        chains = []

        def lists(o):
            if isinstance(o, list) and len(o) >= 2 and all(isinstance(x, dict) and 'at' in x for x in o):
                chains.append(o)
            if isinstance(o, dict):
                for v in o.values():
                    lists(v)
            elif isinstance(o, list):
                for v in o:
                    lists(v)
        lists(section_of(ans, section))
        for c in chains:
            files = [norm_at(h['at'], False) for h in c]
            hops = [(a, b) for a, b in zip(files, files[1:]) if a != b]
            if files[0] == start and files[-1] == end and hops and all(h in edges for h in hops):
                print(f'  chain ok: {" -> ".join(files)}')
                return 0
        print(f'  no chain {start} -> {end} made only of oracle edges among {len(chains)} chain(s)')
        return 1

    picked = [r for r in rows if r.get('role') == role and keep(r, head.get('filter', '-'))]
    got = []
    exp_by_prefix = {}
    for e in exp:
        exp_by_prefix.setdefault(e[:-1], []).append(e)
    for r in sorted(picked, key=lambda r: r.get('rank', 0)) if grade == 'ORDER' else picked:
        t = tuple(norm_at(r['at'], want_line) if f == 'at' else (field(r, f) if field(r, f) is not None else '') for f in fields)
        # SPEC 10: a body cut at the line limit says `cut: true` with body_lines; it counts as the expected body
        # when it is that body's first lines and body_lines equals the expected line count
        if fields[-1] == 'code' and r.get('cut') in (True, 'true', 1):
            for e in exp_by_prefix.get(t[:-1], []):
                full = e[-1]
                nlines = 0 if full == '' else len(full.splitlines()) + (1 if full.endswith(('\n', '\r')) else 0)
                if full.startswith(t[-1]) and num(r.get('body_lines')) == nlines:
                    t = e
        got.append((t, r.get('status')))
    got_set = {t for t, _ in got}
    exp_set = set(exp)
    if not exp:
        print('  0 expected tuples: not gradable (a 0/0 is not a pass)')
        return 1
    if grade == 'SET':
        ok = got_set == exp_set
    elif grade == 'SET>=':
        extra_match = {t for t, st in got if t not in exp_set and st == 'match'}
        ok = exp_set <= got_set and not extra_match
    elif grade == 'ORDER':
        # the full sequence, repeats included (an outline lists several rows on one line)
        seq = [t for t, _ in got]
        ok = seq == exp
    else:
        print(f'  unknown grade {grade}')
        return 1
    if not ok:
        print(f'  role {role}: expected {sorted(exp_set) if grade != "ORDER" else exp}')
        print(f'  role {role}: answer   {sorted(got_set) if grade != "ORDER" else [t for t, _ in got]}')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
