#!/usr/bin/env python3
"""tests/facts_cache.py: an upgraded plugin does not answer from edges an older one exported.

path and impact read their edges from `.axiomcode/out/dl/edge.facts`, exported once and reused while graph.sqlite is
unchanged. The stamp used to be graph.sqlite's mtime alone, so after an upgrade that changed which edges are exported
(#1402: `defines` from a generated member's span) the old file kept answering, and `index` said the graph was up to
date and rebuilt nothing. The stamp now carries a version; this plants an export in the old format holding one edge
the code does not export and checks that neither query walks it.

Indexes one case, so it needs the engine (AXIOMCODE_ENGINE, as tests/run.py).

    python3 tests/facts_cache.py
"""
import os, shutil, sqlite3, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AX = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode')
CASE = os.path.join(ROOT, 'tests', 'cases', 'java', 'containment-not-from-a-shared-span', 'src')


def run(*a):
    p = subprocess.run(['bash', AX] + list(a), capture_output=True, text=True, timeout=600)
    return p.stdout + p.stderr


def main():
    work = tempfile.mkdtemp(prefix='axiomcode-factscache-')
    try:
        repo = os.path.join(work, 'repo'); shutil.copytree(CASE, repo)
        out = run('index', repo, '--lang', 'java')
        db = os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')
        if not os.path.exists(db): print('facts_cache: index failed\n' + out[-1500:]); return 1
        con = sqlite3.connect(db)
        ids = {d: i for d, i in con.execute("SELECT display, id FROM symbols WHERE display IN ('Caller.m', 'Sink.modeB') AND method_id IS NOT NULL")}
        if len(ids) != 2: print(f'facts_cache: expected 2 symbols, found {sorted(ids)}'); return 1
        checks = [('path', ['path', 'Caller.m', 'Sink.modeB', repo], 'no chain of resolved calls connects', 'defines'),
                  ('impact', ['impact', 'Sink.modeB', repo], 'Caller.k', 'Caller.m')]
        bad = 0
        for why, cmd, want, avoid in checks:
            run(*cmd)                                         # the current export, stamped the current way
            dl = os.path.join(repo, '.axiomcode', 'out', 'dl')
            # what an older plugin left behind: its stamp format (the bare mtime) and an edge the code does not export
            open(os.path.join(dl, 'stamp'), 'w').write(str(os.path.getmtime(db)))
            with open(os.path.join(dl, 'edge.facts'), 'a') as f: f.write(f"{ids['Caller.m']}\t{ids['Sink.modeB']}\tdefines\n")
            text = run(*cmd)
            ok = want in text and avoid not in text and 'Traceback' not in text
            print(('ok   ' if ok else 'FAIL ') + f'{why} does not answer from an export stamped by an older plugin')
            if not ok: bad += 1; print('     ' + text[-800:].replace('\n', '\n     '))
        print(f"{len(checks) - bad} of {len(checks)} check(s) held" if not bad else f"{bad} FAILED")
        return 1 if bad else 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
