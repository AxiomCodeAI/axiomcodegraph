#!/usr/bin/env python3
"""kinds.py [--scripts <dir>] [--engine <checkout>] — fixtures for the change kinds that are not a plain declaration (#758).

Half of the commits that touch Java change something the target grammar could not name: an annotation on a declaration, a
throws clause, an enum constant that does not exist yet. Each of these now has a target or a section, and each is asserted
here on one four-file fixture (validate/kinds/): a decorated method that throws, two callers — one declaring the exception,
one catching it — an enum, and a switch over it.
"""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
S = sys.argv[sys.argv.index('--scripts') + 1] if '--scripts' in sys.argv else os.path.join(HERE, '..', 'skills', 'axiomcode', 'scripts')
ENGINE = sys.argv[sys.argv.index('--engine') + 1] if '--engine' in sys.argv else os.path.abspath(os.path.join(HERE, '..', '..', '..'))
D = os.path.join(HERE, 'kinds')

def graph():
    if not os.path.exists(os.path.join(D, '.axiomcode', 'out', 'graph.sqlite')):
        subprocess.run(['bash', os.path.join(S, 'axiomcode'), 'index', D, '--lang', 'java', '--src', 'src'],
                       capture_output=True, text=True, env=dict(os.environ, AXIOMCODE_ENGINE=ENGINE))
    return os.path.exists(os.path.join(D, '.axiomcode', 'out', 'graph.sqlite'))

CASES = [                                       # (target, extra args, [substrings the answer must contain])
 ('@Transactional', [], ['1 declaration(s) carry it', 'Svc.save', 'carries this decoration']),
 ('Svc.save', [], ['throws: this method declares IOException', 'reaches all 2 resolved caller(s)', 'Caller.a', 'Caller.b']),
 ('Svc.plain', [], []),                          # no throws clause: no throws line at all
 ('Status.<new>', [], ['a constant to be added to Status', 'Router.label', 'a new constant needs an arm here']),
 ('Status', ['--kind', 'type'], ['switches over the enum']),
 # deleting an override: abstract and concrete are opposite answers, and the tool used to print the same
 # sentence for both. `overrides` joined to methods.kind decides it.
 ('Impl.must', ['--delete'], ['implements the abstract', 'Base.must', 'the build fails']),
 ('Impl.may', ['--delete'], ['overrides the concrete', 'Base.may', 'COMPILES']),
]
NEVER = {'Svc.plain': ['throws:'],
         # the concrete case must NOT be given as a build-breaking reason
         'Impl.may': ['leaves the type without an implementation']}

def main():
    if not graph(): print("kinds: skipped — could not build the fixture graph (needs the engine)"); return 0
    bad = 0; n = 0
    for target, extra, must in CASES:
        out = subprocess.run([sys.executable, os.path.join(S, 'axiomcode-impact'), target, D, *extra], capture_output=True, text=True).stdout
        for m in must:
            n += 1
            if m not in out: print(f"  ✗ {target}: the answer does not contain `{m}`"); bad += 1
        for m in NEVER.get(target, []):
            n += 1
            if m in out: print(f"  ✗ {target}: the answer contains `{m}` and should not"); bad += 1
    print(f"change kinds: {len(CASES)} fixtures, {n} assertions, {bad} wrong")
    return 1 if bad else 0

if __name__ == '__main__': sys.exit(main())
