#!/usr/bin/env python3
"""tests/fill.py — the whole graph's unresolved sites as a worklist, settled in batches, told to the agent once per build.

One throwaway Python repository with four unresolved sites: `cb(i)`, a callback read out of a dict, which may land in
the project, and three a library's methods on untyped values (`opts.get(..)` twice, `text.strip()`).

  build      the index ends with the summary line: 1 site may land in the project, 3 are a library's
  worklist   `unresolved` lists the callback site only, with the function handed in as its candidate; --all lists all
             four (the control: the three are filtered, not missing); the counts are the same either way
  batch      `link --batch -` links the callback to `progress` and refuses a target that is not a declaration (exit 1,
             with the reason); impact then walks the edge as [asserted]; the site drops off the list
  skip       `?` leaves a site open: it drops off the list until its line's text changes, then it is listed again
  notice     `--notice hook` speaks once per build: again only after the graph changes, never with nothing open

    python3 tests/fill.py [-v]
"""
import json, os, shutil, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts')
AX = os.path.join(SCRIPTS, 'axiomcode')
FILL = os.path.join(SCRIPTS, 'ax_fill.py')

JOBS = '''from html import escape


def progress(i):
    return i


def run(opts, items):
    cb = opts.get("cb")
    for i in items:
        cb(i)
    text = opts.get("title")
    return text.strip()


def page(s):
    return escape(s)


def main():
    run({"cb": progress, "title": " x "}, [1, 2])
    page("<b>")
'''
CB_LINE = 11
VERBOSE = '-v' in sys.argv


def sh(cwd, *cmd, stdin=None):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, input=stdin)
    if VERBOSE: print(f"$ {' '.join(cmd)}\n{r.stdout}{r.stderr}")
    return r


def summary(repo):
    return json.loads(sh(repo, 'python3', FILL, repo, '--summary', '--json').stdout)


def listing(repo, *flags):
    return json.loads(sh(repo, AX, 'unresolved', '--json', '--limit', '50', *flags, repo).stdout)['sites']


def main():
    bad = []; checks = 0
    def check(ok, what):
        nonlocal checks
        checks += 1
        if not ok: bad.append(what)
        if VERBOSE: print(('ok   ' if ok else 'FAIL ') + what)

    # no graph: what counts as a library's call, both directions
    sys.path.insert(0, SCRIPTS)
    import ax_links, ax_fill
    rp = ax_links.runs_a_process
    check(not rp('m.invoke', 'external:java.lang.reflect.Method.invoke') and not rp('fn.apply', 'builtin:Function.apply')
          and not rp('t.run', 'external:Thread.run'), 'library: a call that runs a value it is handed stays a site (control)')
    check(rp('run', 'external:subprocess.run') and rp('run', 'external:_sp.run', ['    import platform as _p, subprocess as _sp'])
          and rp('cp.exec', 'external:cp.exec', ["import * as cp from 'child_process'"]),
          'library: a process launcher is not one, through an alias too')
    names = ax_fill.imported_names(['from html import escape', 'import os.path as osp', "import { z } from 'zod'",
                                    "import { local } from './mine'"])
    check({'escape', 'osp', 'z'} <= names and 'local' not in names, f'library: imported names, a relative import excluded (got {sorted(names)})')

    repo = tempfile.mkdtemp(prefix='ax-fill-')
    try:
        os.makedirs(os.path.join(repo, 'app'))
        open(os.path.join(repo, 'app', '__init__.py'), 'w').close()
        open(os.path.join(repo, 'app', 'jobs.py'), 'w').write(JOBS)
        sh(repo, 'git', 'init', '-q'); sh(repo, 'git', 'add', '-A')
        sh(repo, 'git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init')
        b = sh(repo, AX, 'index', repo)
        check(b.returncode == 0 and os.path.isfile(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')), 'build: the graph is built')
        last = [l for l in b.stdout.split('\n') if l.strip()][-1:] or ['']
        check(last[0].startswith('graph: ') and '1 may land in the project' in last[0] and "3 a library's method" in last[0],
              f'build: the index ends with the summary line (got {last[0][:160]!r})')

        s = summary(repo)
        check((s['unresolved'], s['library'], s['open']) == (4, 3, 1), f"worklist: 4 unresolved, 3 library, 1 open (got {s})")
        sites = listing(repo)
        cb = [x for x in sites if x['call'] == 'cb']
        check(len(sites) == 1 and len(cb) == 1 and cb[0]['at'] == f'app/jobs.py:{CB_LINE}', f"worklist: only the callback site is listed (got {[x['site'] for x in sites]})")
        check(bool(cb) and any(c['target'] == 'progress' for c in cb[0]['candidates']), 'worklist: the function handed in is its candidate')
        every = listing(repo, '--all')
        check(len(every) == 4 and {x['call'] for x in every} == {'cb', 'get', 'strip'}, f"worklist --all: the control lists all four (got {[x['call'] for x in every]})")
        check(summary(repo)['open'] == 1, 'worklist --all: the counts do not change')
        site = cb[0]['site'] if cb else f'app/jobs.py:{CB_LINE}'

        r = sh(repo, AX, 'link', '--batch', '-', repo, stdin=f"{site} progress\n{site} no_such_function_here\n")
        check(r.returncode == 1 and 'refused' in r.stdout and 'not a declaration' in r.stdout, f'batch: a bad target is refused with its reason, exit 1 (rc {r.returncode})')
        check('1 linked' in r.stdout, 'batch: the good line is linked anyway')
        s = summary(repo)
        check((s['asserted'], s['open']) == (1, 0), f"batch: 1 asserted, nothing open (got {s})")
        imp = sh(repo, AX, 'impact', 'progress', repo)
        check('[asserted]' in imp.stdout and f'app/jobs.py:{CB_LINE}' in imp.stdout, 'batch: impact walks the asserted edge')
        links = open(os.path.join(repo, 'axiomcode-links.tsv')).read()
        check('no_such_function_here' not in links and '\tprogress\t' in links, 'batch: only the validated link is written')

        sh(repo, AX, 'link', f'app/jobs.py:{CB_LINE}', '-', repo)
        check(summary(repo)['open'] == 1, 'skip: removing the link opens the site again')
        r = sh(repo, AX, 'link', '--batch', '-', repo, stdin=f"{site} ?\n")
        s = summary(repo)
        check(r.returncode == 0 and (s['open'], s['skipped']) == (0, 1), f"skip: `?` leaves it open and off the list (got {s})")
        p = os.path.join(repo, 'app', 'jobs.py')
        L = open(p).read().split('\n'); L[CB_LINE - 1] = L[CB_LINE - 1] + '  # now reads the callback twice'
        open(p, 'w').write('\n'.join(L))
        check(summary(repo)['open'] == 1, 'skip: an edit to the skipped line lists it again')
        open(p, 'w').write(JOBS)
        check(summary(repo)['open'] == 0, 'skip: restoring the line text skips it again (the skip is keyed by the text)')
        os.remove(os.path.join(repo, '.axiomcode', 'fill-skipped.tsv'))
        check(summary(repo)['open'] == 1, 'skip: the skips are derived; deleting them only asks again')

        n1 = sh(repo, 'python3', FILL, repo, '--notice', 'hook').stdout.strip()
        n2 = sh(repo, 'python3', FILL, repo, '--notice', 'hook').stdout.strip()
        check(n1.startswith('graph: the engine left 1 call site') and '/axiomcode:fill' in n1, f'notice: the first prompt after the build hears it (got {n1[:120]!r})')
        check(n2 == '', 'notice: the second does not')
        m = sh(repo, 'python3', FILL, repo, '--notice', 'mcp').stdout.strip()
        check('unresolved()' in m and 'unresolved(decisions' in m and '/axiomcode:fill' not in m, 'notice: the MCP surface names its tools, not the slash command')
        db = os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')
        t = time.time() + 5; os.utime(os.path.realpath(db), (t, t))
        check(sh(repo, 'python3', FILL, repo, '--notice', 'hook').stdout.strip() != '', 'notice: a new build is heard about again')
        sh(repo, AX, 'link', '--batch', '-', repo, stdin=f"{site} progress\n")
        t += 5; os.utime(os.path.realpath(db), (t, t))
        check(sh(repo, 'python3', FILL, repo, '--notice', 'hook').stdout.strip() == '', 'notice: silent when nothing is open')
    finally:
        shutil.rmtree(repo, ignore_errors=True)

    for b_ in bad: print('FAIL', b_)
    print(f"{checks - len(bad)} of {checks} check(s) passed")
    return 1 if bad or checks == 0 else 0


if __name__ == '__main__':
    sys.exit(main())
