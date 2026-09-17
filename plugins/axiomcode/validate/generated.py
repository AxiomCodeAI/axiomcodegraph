#!/usr/bin/env python3
"""generated.py [--scripts <dir>] [--engine <checkout>] — fixtures for the generated-member conventions.

`impact` assumes that a decoration, a base class or a record declares members the source never spells: Lombok's accessors
and all-args constructor, a dataclass, an attrs class, a pydantic model. Those members have no declaration, so a call to
one is an UNRESOLVED site and only this table connects it to the field it reads. Three ways that used to fail (#750):

  a project-local wrapper       `def frozen(cls): return dataclass(frozen=True)(cls)` — the name is not in the table
  a generator that is a BASE    `class User(BaseModel)` — inheritance, not a decoration, and the base is a library type
  a decoration ON THE FIELD     `@Getter @Setter private String zipCode` — the common Lombok form

Each fixture is two small files under validate/generated/. The graph is built once (the engine is needed; ~30 s) and kept,
so a rerun is seconds. Every assertion names the row the answer must contain.
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
S = sys.argv[sys.argv.index('--scripts') + 1] if '--scripts' in sys.argv else os.path.join(HERE, '..', 'skills', 'axiomcode', 'scripts')
ENGINE = sys.argv[sys.argv.index('--engine') + 1] if '--engine' in sys.argv else os.path.abspath(os.path.join(HERE, '..', '..', '..'))

# (fixture, language, target, --kind, [(substring that must appear in some row's `why`, the row's display)], fired entry)
CASES = [
 ('py', 'python', 'Point.x', 'field', [('generated constructor', 'build')], 'frozen'),
 ('py', 'python', 'User.login', 'field', [('generated constructor', 'build')], 'BaseModel'),
 ('java', 'java', 'Address.zipCode', 'field', [('generated getter', 'Client.len'), ('generated setter', 'Client.set')], 'Getter'),
]

def graph(fix, lang):
    d = os.path.join(HERE, 'generated', fix)
    if not os.path.exists(os.path.join(d, '.axiomcode', 'out', 'graph.sqlite')):
        env = dict(os.environ, AXIOMCODE_ENGINE=ENGINE)
        r = subprocess.run(['bash', os.path.join(S, 'axiomcode'), 'index', d, '--lang', lang, '--src', 'src'],
                           capture_output=True, text=True, env=env)
        if not os.path.exists(os.path.join(d, '.axiomcode', 'out', 'graph.sqlite')):
            print(f"  … {fix}: could not build the graph ({(r.stdout + r.stderr).strip().splitlines()[-1][:90] if (r.stdout + r.stderr).strip() else 'no output'})"); return None
    return d

def main():
    bad = 0; n = 0; skipped = 0
    for fix, lang, target, kind, expect, fired in CASES:
        d = graph(fix, lang)
        if not d: skipped += 1; continue
        r = subprocess.run([sys.executable, os.path.join(S, 'axiomcode-impact'), target, d, '--kind', kind, '--json'], capture_output=True, text=True)
        try: j = json.loads(r.stdout)
        except Exception:
            print(f"  ✗ {fix}/{target}: impact failed: {(r.stdout + r.stderr).strip()[-100:]}"); bad += 1; continue
        rows = j.get('direct', [])
        for why, display in expect:
            n += 1
            if not any(why in x['why'] and x['display'].endswith(display) for x in rows):
                print(f"  ✗ {fix}/{target}: no row saying `{why}` on {display}; got " + (', '.join(f"{x['display']}: {x['why'][:40]}" for x in rows[:3]) or 'nothing')); bad += 1
        n += 1
        if fired not in (r.stdout or '') and not any(fired in x.get('why', '') for x in rows):
            # the fired-conventions line is printed, not in the json: ask for it in text form
            t = subprocess.run([sys.executable, os.path.join(SS := os.path.join(S), 'axiomcode-impact'), target, d, '--kind', kind], capture_output=True, text=True).stdout
            if fired not in t: print(f"  ✗ {fix}/{target}: the answer does not say which convention fired (expected {fired})"); bad += 1
    print(f"generated members: {len(CASES) - skipped} fixtures, {n} assertions, {bad} wrong" + (f" ({skipped} skipped — no engine)" if skipped else ''))
    return 1 if bad else 0

if __name__ == '__main__': sys.exit(main())
