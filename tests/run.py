#!/usr/bin/env python3
"""tests/run.py [<case> …] [--lang java|python|typescript|javascript] [--keep] [-v]

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
"""
import json, os, re, shutil, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
AX = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode')
args = sys.argv[1:]; keep = '--keep' in args; verbose = '-v' in args
lang = args[args.index('--lang') + 1] if '--lang' in args else None
only = [a for a in args if not a.startswith('-') and a not in (lang,)]
cases = []
for l in sorted(os.listdir(os.path.join(HERE, 'cases'))):
    if lang and l != lang: continue
    d = os.path.join(HERE, 'cases', l)
    for c in sorted(os.listdir(d)):
        if os.path.isfile(os.path.join(d, c, 'case.json')) and (not only or c in only or l in only): cases.append((l, c, os.path.join(d, c)))
fail = tot = 0
for l, name, path in cases:
    print(f"… {l}/{name}", flush=True)
    spec = json.load(open(os.path.join(path, 'case.json')))
    build = ['bash', AX, 'index', path, '--lang', spec.get('lang', l)] + (['--src', spec['src']] if spec.get('src') else [])
    r = subprocess.run(build, capture_output=True, text=True)
    if r.returncode: print(f"FAIL {l}/{name}: index failed: {(r.stderr or r.stdout)[-300:]}"); fail += 1; continue
    for stmt in spec.get('sql', []):                                  # facts a framework extension would have written
        subprocess.run(['sqlite3', os.path.join(path, '.axiomcode', 'out', 'graph.sqlite'), stmt], capture_output=True, text=True)
    for ch in spec['checks']:
        tot += 1
        out = subprocess.run(['bash', AX] + [a.replace('{repo}', path) for a in ch['run']] + ([path] if ch['run'][0] != 'index' else []), capture_output=True, text=True)
        text = out.stdout + out.stderr
        bad = [w for w in ch.get('want', []) if w not in text] + [f"(present) {w}" for w in ch.get('avoid', []) if w in text]
        if out.returncode and not ch.get('expect_error'): bad.append(f"(exit {out.returncode})")
        if bad:
            fail += 1; print(f"FAIL {l}/{name}: {ch['why']}", flush=True)
            for b in bad: print(f"     missing/unwanted: {b}")
            print('     ' + '\n     '.join(text.strip().split('\n')[:14]))
        elif verbose: print(f"ok   {l}/{name}: {ch['why']}")
    if not keep: shutil.rmtree(os.path.join(path, '.axiomcode'), ignore_errors=True)
print(f"\n{tot - fail} of {tot} check(s) passed in {len(cases)} case(s)" + ('' if not fail else f" - {fail} FAILED"))
sys.exit(1 if fail else 0)
