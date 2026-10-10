#!/usr/bin/env python3
"""Grade one --json answer against one expected answer of the queries/ suite (SPEC 6.2 / 6.3).

  grade_query.py <answer.json> <expected Qn.tsv>        exit 0 correct, 1 wrong, 4 truncated (re-ask with --limit 0),
                                                        5 skipped (iteration-2 template, never counted correct)

The answer contract (SPEC 6.2): web rows are JSON objects carrying at least `at` ("file:line" or a file), `role`,
`status` and, for ordered sections, `rank`. The JavaScript graph's rows sit under other_languages.javascript.
Field aliases accepted for a tuple column: calleeName = calleeName | callee_name | callee; names may be a list.
An expected `at` without a line compares the answer's file part only.
"""
import json
import sys

ALIASES = {'calleeName': ['calleeName', 'callee_name', 'callee'], 'name': ['name', 'function', 'qualified_name'],
           'literal': ['literal'], 'property': ['property', 'prop'], 'reason': ['reason'], 'conditions': ['conditions'],
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
    if section == 'javascript':
        ol = ans.get('other_languages', {}) if isinstance(ans, dict) else {}
        if 'javascript' in ol:
            return ol['javascript']
        return ans if isinstance(ans, dict) and ans.get('language') == 'javascript' else {}
    return ans


def field(row, name):
    for k in ALIASES.get(name, [name]):
        if k in row:
            v = row[k]
            return ','.join(sorted(map(str, v))) if isinstance(v, list) else str(v)
    return None


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
            exp.append(tuple(line.split('\t')))
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
    want_line = bool(exp) and grade not in ('CHAIN', 'TOP-k') and ':' in exp[0][0] and exp[0][0].rsplit(':', 1)[1].isdigit()

    if grade == 'TOP-k':
        places = []
        for r in rows:
            f = norm_at(r.get('at') or r.get('file') or '', False)
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

    picked = [r for r in rows if r.get('role') == role]
    got = []
    for r in sorted(picked, key=lambda r: r.get('rank', 0)) if grade == 'ORDER' else picked:
        t = tuple([norm_at(r['at'], want_line)] + [field(r, f) for f in fields[1:]])
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
        seq = []
        for t, _ in got:
            if t not in seq:
                seq.append(t)
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
