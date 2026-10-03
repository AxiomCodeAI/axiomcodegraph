#!/usr/bin/env python3
"""tests/export_singleflight.py — one facts export per graph, however many queries arrive at once.

The facts a query solves over (out/dl, out/dl/impact) are exported once per graph.sqlite and reused. The export
had no lock: a query that found the stamp stale while another process was already writing the same facts — the
build's background warm-up, a second query, several hooks at once — ran the WHOLE export again beside it. On an
8,619-file repository the first query after `index` cost 193 s against 8.8 s warm, and every concurrent query
paid the same again. Now the first comer takes out/dl/impact/.exporting and the rest wait for its stamp; a lock
whose writer died is taken over.

Checks, on one indexed fixture:
  1. wait:     a lock held by a LIVE process makes a stale --warm wait, and when the holder restores the fresh
               stamp and releases, the waiter returns WITHOUT re-exporting (the stamp file is untouched).
  2. takeover: a lock left by a DEAD process does not block — the next --warm removes it and exports.
  3. unlock:   a finished export leaves no .exporting behind.

Indexes one case, so it needs the engine (AXIOMCODE_ENGINE, as tests/run.py).

    python3 tests/export_singleflight.py
"""
import os, shutil, subprocess, sys, tempfile, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AX = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode')
IMPACT = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode-impact')
CASE = os.path.join(ROOT, 'tests', 'cases', 'java', 'containment-not-from-a-shared-span', 'src')


def run(*a, timeout=600):
    p = subprocess.run(['bash', AX] + list(a), capture_output=True, text=True, timeout=timeout)
    return p.returncode, p.stdout + p.stderr


def main():
    fails = []
    def check(ok, why, detail=''):
        print(('ok   ' if ok else 'FAIL ') + why + ('' if ok else '\n     ' + detail.strip().replace('\n', '\n     ')))
        if not ok: fails.append(why)

    work = tempfile.mkdtemp(prefix='axiomcode-singleflight-')
    try:
        repo = os.path.join(work, 'repo'); shutil.copytree(CASE, repo)
        rc, out = run('index', repo, '--lang', 'java')
        if rc: print(f"FAIL index: {out[-300:]}"); return 1
        rc, out = run('impact', '--warm', repo)
        check(rc == 0 and 'impact facts ready' in out, 'a first --warm exports the facts', out[-300:])
        D = os.path.join(repo, '.axiomcode', 'out', 'dl', 'impact')
        stamp = os.path.join(D, 'stamp'); lock = os.path.join(D, '.exporting')
        check(not os.path.exists(lock), 'a finished export leaves no .exporting behind', 'lock file still there')

        # 1. WAIT, DON'T RE-EXPORT: hold the lock as a live process, hide the stamp so the waiter sees stale facts,
        # then put the fresh stamp back and release. The waiter must return 0 having written nothing: the stamp's
        # mtime is the proof, set well in the past so any rewrite moves it.
        held = open(lock, 'w'); held.write(str(os.getpid())); held.flush()
        past = time.time() - 3600; os.utime(stamp, (past, past)); before = os.path.getmtime(stamp)
        saved = stamp + '.aside'; os.rename(stamp, saved)

        def release():
            time.sleep(2); os.rename(saved, stamp); held.close(); os.remove(lock)
        t = threading.Thread(target=release); t.start()
        t0 = time.time(); rc, out = run('impact', '--warm', repo, timeout=120); waited = time.time() - t0
        t.join()
        check(rc == 0, 'a --warm against a held lock returns 0 once the holder finishes', out[-300:])
        check(waited >= 2, f'it waited for the holder ({waited:.1f}s)', 'returned before the lock was released')
        check(os.path.getmtime(stamp) == before, 'and re-exported nothing: the stamp is the one the holder left',
              'stamp mtime moved — the waiter exported over the holder')

        # 2. TAKEOVER: a dead writer's lock does not block. Plant a lock naming a pid that is gone, stale the
        # stamp for real, and the next --warm must remove the lock and export.
        os.remove(stamp)
        open(lock, 'w').write('999999999')
        t0 = time.time(); rc, out = run('impact', '--warm', repo, timeout=120)
        check(rc == 0 and os.path.exists(stamp), 'a dead writer\'s lock is taken over and the export runs', out[-300:])
        check(not os.path.exists(lock), 'and the taken-over lock is released', 'lock file still there')
    finally:
        shutil.rmtree(work, ignore_errors=True)

    print(('FAIL: ' + '; '.join(fails)) if fails else 'all export_singleflight checks passed')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
