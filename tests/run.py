#!/usr/bin/env python3
"""tests/run.py [<case> …] [--lang java|python|typescript|javascript] [--keep] [-v] [--jobs N]

What the plugin CLAIMS to find, checked on code that is small enough to read. Each case is a directory under
tests/cases/<language>/<name>/ holding a tiny synthetic project and a case.json:

  {"lang": "java", "src": "src",
   "checks": [{"why":   "a this.field write in an unrelated class is not this field",
               "run":   ["impact", "A.url", "--kind", "field"],
               "want":  ["reads it through url()"],          # substrings that MUST appear
               "avoid": ["B.B", "B.url"]}]}                   # substrings that must NOT appear

The case is indexed once (into its own .axiomcode, removed afterwards unless --keep) and every check is run against
it. A check fails loudly with the line that was wrong, so a regression names itself. No corpus, no network, nothing
outside the case directory.

Four other keys a check may carry:

  "same_as": [run …]     STDOUT must be byte-identical to that other run's: a switch that must leave an answer alone.

  "stdout_json": true    STDOUT ALONE must parse as one JSON document. `want` and `avoid` read stdout and stderr
                         CONCATENATED, so no substring can express "this must not be inside the document" — which is
                         how a `note:` line sat in --json for every name declared as both a field and a method.
  "expect_error": true   a non-zero exit is the answer, not a fault (`path` exits 1 when it finds no chain).
  "env": {name: value}   the check runs with these environment variables set (AXIOMCODE_FRONT=1 for the front door).
  "edit": [file, old, new]  the case edits that file before the check runs; edited files and a links file the case
                         wrote are restored when the case ends.
  "pending": "<issue>"   the check states behaviour the tool does NOT have yet. It still RUNS. Failing prints PEND and
                         is not a suite failure; PASSING is a failure reading "remove the marker", so a gap that
                         closes cannot keep a marker claiming it is open.

  PENDING IS DECIDED FROM want / avoid MISMATCHES ONLY, NEVER FROM THE EXIT CODE, and that is the property that makes
  it safe rather than dangerous. A marker that absorbed an unexpected non-zero exit would be a hiding place for real
  breakage: both of the defects this suite surfaced on 2026-09-18 were a silent empty answer and an unreadable one,
  and neither announces itself as a want/avoid mismatch. If anyone ever "simplifies" `pending` into a skip, that is
  the property they will have removed.
"""
import builtins, concurrent.futures, io, json, os, re, shutil, sqlite3, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
AX = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode')
# THE DISPATCHER IS STARTED AS THE PRODUCT STARTS IT, so the cases answer for Windows too: Git Bash found the way the CLI
# finds it (a bare `bash` there is System32's WSL launcher), MSYS=noglob as the CLI sets it (`'*'` reached the verbs as the
# directory's file names), and the arguments handed over by ax_exec.bash_argv (msys misparses `'` and `"` on a command line).
sys.path.insert(0, os.path.dirname(AX)); import ax_exec, ax_fresh, time
def clear(path):
    """remove a case's .axiomcode once nothing is writing it. A check that edits a file leaves a background refresh
    running after the case's last answer; removed under it, the refresh failed and wrote that failure into what Windows
    could not delete (an open file there cannot be), and the next run of the case found a graph that "failed on this
    tree", which is not retried. So: wait for the refresh and any build, then remove, retrying what is still held."""
    d = os.path.join(path, '.axiomcode')
    end = time.time() + 180
    while os.path.isdir(d) and time.time() < end and (ax_fresh.refresher_running(path) or ax_fresh.building(path)): time.sleep(0.5)
    while os.path.isdir(d) and time.time() < end:
        shutil.rmtree(d, ignore_errors=True)
        if os.path.isdir(d): time.sleep(0.5)
for _s in (sys.stdout, sys.stderr): _s.reconfigure(encoding='utf-8', errors='replace')   # answers print → and ·; Windows' file encoding is cp1252
BASH = os.environ.get('AXIOMCODE_BASH') or (subprocess.run(['node', '-e', "process.stdout.write(require(process.argv[1]).findBash().bash || '')",
       os.path.join(ROOT, 'plugins', 'axiomcode', 'mcp', 'find-bash.js')], capture_output=True, text=True).stdout if os.name == 'nt' else '') or 'bash'
BASE_ENV = dict(os.environ, MSYS=(os.environ.get('MSYS', '') + ' noglob').strip()) if os.name == 'nt' else None
def ax(argv, env=None):
    a, e = ax_exec.bash_argv(AX, argv, env if env is not None else BASE_ENV, BASH)
    return subprocess.run(a, capture_output=True, text=True, encoding='utf-8', errors='replace', env=e)
args = sys.argv[1:]; keep = '--keep' in args; verbose = '-v' in args
lang = args[args.index('--lang') + 1] if '--lang' in args else None
jobs = int(args[args.index('--jobs') + 1]) if '--jobs' in args else 1
only = [a for a in args if not a.startswith('-') and a not in (lang, str(jobs))]
cases = []
for l in sorted(os.listdir(os.path.join(HERE, 'cases'))):
    if lang and l != lang: continue
    d = os.path.join(HERE, 'cases', l)
    for c in sorted(os.listdir(d)):
        if os.path.isfile(os.path.join(d, c, 'case.json')) and (not only or c in only or l in only): cases.append((l, c, os.path.join(d, c)))
def run_case(case):
    """one case: index it, run its checks; its output as one block and its counts, so cases can run side by side"""
    l, name, path = case; buf = io.StringIO(); fail = tot = pend = 0
    def print(*a, flush=False, **k): builtins.print(*a, file=buf, **k)
    print(f"… {l}/{name}", flush=True)
    spec = json.load(open(os.path.join(path, 'case.json'), encoding='utf-8'))
    clear(path)                                                       # what a stopped run left: start as a fresh checkout does
    build = ['index', path, '--lang', spec.get('lang', l)] + (['--src', spec['src']] if spec.get('src') else []) \
        + (['--library', os.path.join(path, spec['library'])] if spec.get('library') else [])   # a staged dependency root, relative to the case
    r = ax(build)
    if r.returncode: print(f"FAIL {l}/{name}: index failed: {(r.stderr or r.stdout)[-300:]}"); return buf.getvalue(), 0, 1, 0
    for stmt in spec.get('sql', []):                                  # facts a framework extension would have written
        try:                                                          # the module, not the sqlite3 program: Windows has none
            with sqlite3.connect(os.path.join(path, '.axiomcode', 'out', 'graph.sqlite')) as db: db.executescript(stmt)
        except sqlite3.Error: pass
    # "edit": [file, old, new] — the case edits one of its files before that check runs (an asserted link whose line moved
    # or changed); every edited file, and a links file the case wrote, is put back when the case ends
    links_file = os.path.join(path, 'axiomcode-links.tsv'); links_had = open(links_file, encoding='utf-8', newline='').read() if os.path.exists(links_file) else None
    edited = {}
    for ch in spec['checks']:
        tot += 1
        if ch.get('edit'):
            ef, old, new = ch['edit']; fp = os.path.join(path, ef); txt = open(fp, encoding='utf-8', newline='').read()
            edited.setdefault(fp, txt)
            if old not in txt: print(f"FAIL {l}/{name}: the edit's old text is not in {ef}"); fail += 1; continue
            open(fp, 'w', encoding='utf-8', newline='').write(txt.replace(old, new, 1))
        # "env": {…} — the check runs with these set (AXIOMCODE_FRONT=1: the answer the installed command and MCP give)
        out = ax([a.replace('{repo}', path) for a in ch['run']] + ([path] if ch['run'][0] != 'index' else []),
                 dict(BASE_ENV or os.environ, **ch['env']) if ch.get('env') else None)
        text = out.stdout + out.stderr
        # a [text] row quoting this case.json is the spec read back (a name no graph declares is searched as text, and the
        # case file lies in the searched tree): its own `avoid` strings there are not the tool's answer
        said = re.sub(r'(?m)^\s*\[text\] case\.json:\d+.*\n?', '', text)
        bad = [w for w in ch.get('want', []) if w not in text] + [f"(present) {w}" for w in ch.get('avoid', []) if w in said]
        # "stdout_json": true — STDOUT alone must parse as one JSON document. A diagnostic printed beside the answer
        # is invisible to a substring check (want/avoid read both streams together) and fatal to a consumer, which is
        # how a `note:` line sat inside --json for every name declared as both a field and a method.
        if ch.get('stdout_json'):
            try: json.loads(out.stdout)
            except Exception as e: bad.append(f"stdout is not one JSON document ({e})")
        # an unexpected non-zero exit is a HARD failure, before `pending` is considered: a marker says "the tool does
        # not do this yet", not "anything may happen here". A crash, a missing fixture or an unreadable answer under
        # a marker would otherwise be indistinguishable from the gap it names, and the marker becomes the hiding
        # place this mechanism exists to remove.
        # "same_as": [run …] — STDOUT must be BYTE-IDENTICAL to another run's: a switch that must not change an answer
        # (evidence on an answer with no uncertain row, a default that is off) is a comparison, not a substring
        if ch.get('same_as'):
            other = ax([a.replace('{repo}', path) for a in ch['same_as']] + [path])
            if other.stdout != out.stdout:
                a_, b_ = out.stdout.split('\n'), other.stdout.split('\n')
                i = next((i for i, (x, y) in enumerate(zip(a_, b_)) if x != y), min(len(a_), len(b_)))
                bad.append(f"stdout differs from {' '.join(ch['same_as'])} at line {i + 1}: {a_[i] if i < len(a_) else '(end)'!r} vs {b_[i] if i < len(b_) else '(end)'!r}")
        crashed = bool(out.returncode) and not ch.get('expect_error')
        if crashed: bad.append(f"(exit {out.returncode})")
        # "pending": "<issue>" — a case that states behaviour the tool does NOT have yet. It still RUNS, and the two
        # outcomes are reported differently on purpose: failing is expected and is not a suite failure, while PASSING
        # is one, because a gap that has closed must not keep a marker saying it is open. Without this a permanently
        # red case becomes furniture — which is how two real defects survived in this suite today, each read past
        # twice as "that one is known".
        if bad and ch.get('pending') and not crashed:
            pend += 1; print(f"PEND {l}/{name} ({ch['pending']}): {ch['why']}", flush=True); continue
        if not bad and ch.get('pending'):
            fail += 1; print(f"FAIL {l}/{name}: marked pending ({ch['pending']}) but it PASSES — remove the marker", flush=True); continue
        if bad:
            fail += 1; print(f"FAIL {l}/{name}: {ch['why']}", flush=True)
            for b in bad: print(f"     missing/unwanted: {b}")
            lines = text.strip().split('\n')
            # a traceback's last line is the error itself: keep the head (what it answered) and the tail (why it stopped)
            print('     ' + '\n     '.join(lines[:14] + (['…'] + lines[-12:] if len(lines) > 26 else lines[14:])))
        elif verbose: print(f"ok   {l}/{name}: {ch['why']}")
    for fp, txt in edited.items(): open(fp, 'w', encoding='utf-8', newline='').write(txt)
    if links_had is None:
        if os.path.exists(links_file): os.remove(links_file)
    else: open(links_file, 'w', encoding='utf-8', newline='').write(links_had)
    if not keep: clear(path)
    return buf.getvalue(), tot, fail, pend


# CASES RUN SIDE BY SIDE with --jobs N: each indexes its own directory and shares nothing but the compiled rules, so the
# first case runs alone (it compiles and caches them) and the rest run N at a time. Output is printed in case order.
fail = tot = pend = 0
def report(res):
    global fail, tot, pend
    text, t, f, p = res; sys.stdout.write(text); sys.stdout.flush(); tot += t; fail += f; pend += p
if cases: report(run_case(cases[0]))
with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, jobs)) as ex:
    for res in ex.map(run_case, cases[1:]): report(res)
print(f"\n{tot - fail - pend} of {tot} check(s) passed in {len(cases)} case(s)" + (f" - {pend} PENDING" if pend else '') + ('' if not fail else f" - {fail} FAILED"))
sys.exit(1 if fail else 0)
