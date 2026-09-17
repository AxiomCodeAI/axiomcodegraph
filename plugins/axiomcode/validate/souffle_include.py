#!/usr/bin/env python3
"""souffle_include.py [--scripts <dir>] — the plugin's Soufflé include resolution, checked against the compiler.

#216 fixed this in the engine; #816 is the same bug shipped again because the plugin carried a SECOND, independent probe.
The plugin now calls the engine's `graph/pipeline/souffle-include.sh` when it is next to it and mirrors its precedence when
it is not — so what this asserts is that the two agree, and that the answer is the directory the compiler can actually use:

  1. the probe returns a directory D with D/souffle/CompiledSouffle.h in it (the include is written `souffle/…`)
  2. where the engine's script is present, the plugin returns the same directory
  3. a real `souffle -g` program compiles with `-I D` (skipped when souffle or c++ is missing)
  4. the too-deep answer — D/souffle, the shape of the original bug — does NOT compile, so the test would have caught it

Every step is skipped, loudly, when the toolchain is absent; nothing here needs a graph.
"""
import importlib.util, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
S = sys.argv[sys.argv.index('--scripts') + 1] if '--scripts' in sys.argv else os.path.join(HERE, '..', 'skills', 'axiomcode', 'scripts')
spec = importlib.util.spec_from_loader('im', importlib.machinery.SourceFileLoader('im', os.path.join(S, 'axiomcode-impact')))
mod = importlib.util.module_from_spec(spec)
try: spec.loader.exec_module(mod)
except SystemExit: pass

class Probe(mod.Impact):
    def __init__(self): pass

def main():
    bad = 0; n = 0
    if not (os.environ.get('PATH') and __import__('shutil').which('souffle')):
        print("souffle include: skipped — no souffle on PATH"); return 0
    inc = Probe().souffle_include()
    n += 1
    if not inc: print("  ✗ the probe found nothing, though souffle is installed"); print("souffle include: 1 assertion, 1 wrong"); return 1
    n += 1
    if not os.path.exists(os.path.join(inc, 'souffle', 'CompiledSouffle.h')):
        print(f"  ✗ the probe returned {inc}, which holds no souffle/CompiledSouffle.h — the -I must be the directory CONTAINING souffle/"); bad += 1
    sh = os.path.abspath(os.path.join(HERE, '..', '..', '..', 'graph', 'pipeline', 'souffle-include.sh'))
    if os.path.exists(sh):
        n += 1
        r = subprocess.run(['bash', '-c', f'. "{sh}" && find_souffle_include'], capture_output=True, text=True)
        want = [l.strip() for l in (r.stdout or '').strip().splitlines() if l.strip() and not l.startswith('!!')]
        if want and os.path.realpath(want[-1]) != os.path.realpath(inc):
            print(f"  ✗ the plugin resolves {inc} but the engine's script resolves {want[-1]} — two answers to one question is what #816 was"); bad += 1
    if not __import__('shutil').which('c++'):
        print(f"souffle include: {n} assertions, {bad} wrong (compile checks skipped — no c++)"); return 1 if bad else 0
    with tempfile.TemporaryDirectory() as T:
        dl = os.path.join(T, 'p.dl'); open(dl, 'w').write('.decl a(x:symbol)\na("x").\n.output a\n')
        cpp = os.path.join(T, 'p.cpp')
        if subprocess.run(['souffle', '-g', cpp, dl], capture_output=True).returncode or not os.path.exists(cpp):
            print(f"souffle include: {n} assertions, {bad} wrong (souffle -g failed; compile checks skipped)"); return 1 if bad else 0
        n += 1
        ok = subprocess.run(['c++', '-std=c++17', '-O1', '-w', '-I', inc, cpp, '-o', os.path.join(T, 'p'), '-fsyntax-only'], capture_output=True, text=True)
        if ok.returncode: print(f"  ✗ `-I {inc}` does not compile a generated program: {(ok.stderr or '').strip().splitlines()[-1][:120]}"); bad += 1
        deep = os.path.join(inc, 'souffle')                      # the shape of the original bug, when it exists
        if os.path.isdir(deep) and not os.path.exists(os.path.join(deep, 'souffle', 'CompiledSouffle.h')):
            n += 1
            badc = subprocess.run(['c++', '-std=c++17', '-O1', '-w', '-I', deep, cpp, '-o', os.path.join(T, 'q'), '-fsyntax-only'], capture_output=True, text=True)
            if badc.returncode == 0: print(f"  ✗ `-I {deep}` compiles too, so this test cannot tell the bug from the fix on this machine"); bad += 1
    print(f"souffle include: {n} assertions, {bad} wrong")
    return 1 if bad else 0

if __name__ == '__main__': sys.exit(main())
