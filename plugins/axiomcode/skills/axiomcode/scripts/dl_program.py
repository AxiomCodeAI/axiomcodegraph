"""dl_program.py — a Datalog program compiled to a native binary once, cached by the program's hash.

Every query program goes through here: `dl/impact.dl` (axiomcode-impact), and `dl/path*.dl` (axiomcode-path). The cache is keyed by the RULES alone and lives next to them in
`dl/.cache/`, so it is shared by every repository on the machine and survives until the program itself changes.

What this buys is the COMPILE STEP, not query speed: on a 5 MB fact set the binary ran the same program in 1.3 s
against the interpreter's 2.5 s, but on apache/rocketmq (2,265 files, 184k edges) a query took 22.5 s compiled and
19.4 s interpreted — there, loading the facts dominates and the binary wins nothing. Do not quote a speed-up
without saying which graph it was measured on.

Why it must be warmed by `axiomcode index` (`warm()`, called from axiomcode-build) rather than left to the first
query: a caller with a timeout SHORTER than the ~20 s compile kills it every time, so nothing is ever cached and
the next call starts over. `hooks/changes.py` runs impact with `timeout=14` on every Edit — measured on
jackson-databind (1,373 files), 24 of 28 Edit hooks burned the full 14 s and returned "(impact unavailable)",
which was the whole of that benchmark's wall-clock regression. A killed compile leaves no `.nocompile` marker
either (it did not fail, it was killed), so it cannot even record its own defeat.
"""
import hashlib, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DL_DIR = os.path.join(HERE, 'dl')
CACHE = os.path.join(DL_DIR, '.cache')
HOOKS_DIR = os.path.abspath(os.path.join(HERE, '..', '..', '..', 'hooks'))


def souffle_include():
    """where soufflé's C++ headers are. ONE probe: the engine's (`graph/pipeline/souffle-include.sh`) when this plugin
    sits in the engine's checkout, the same precedence inline when it does not — a second, independent probe is what let
    #216 ship again here as #816. The -I is the directory CONTAINING souffle/, and WHICH one that is differs by install:
    Homebrew keeps a second real copy at include/souffle/souffle/, so there it is include/souffle, while a source build
    or a distro package has include/souffle/*.h once, so there it is include. Probing for the file the compiler will
    actually open is the only test that tells them apart — `-I include` on Homebrew redefines every symbol."""
    sh = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..', 'graph', 'pipeline', 'souffle-include.sh'))
    if os.path.exists(sh):
        r = subprocess.run(['bash', '-c', f'. "{sh}" && find_souffle_include'], capture_output=True, text=True)
        for line in reversed((r.stdout or '').strip().splitlines()):
            line = line.strip()
            if line and not line.startswith('!!') and os.path.exists(os.path.join(line, 'souffle', 'CompiledSouffle.h')): return line
    cands = []
    ov = os.environ.get('AXIOM_SOUFFLE_INCLUDE')
    if ov: cands += [ov, os.path.join(ov, 'include', 'souffle'), os.path.join(ov, 'include'), os.path.dirname(ov)]
    b = shutil.which('souffle')
    if b:
        pref = os.path.dirname(os.path.dirname(os.path.realpath(b)))
        cands += [os.path.join(pref, 'include', 'souffle'), os.path.join(pref, 'include')]
    for pref in ('/opt/homebrew', '/usr/local', '/usr'):
        cands += [os.path.join(pref, 'include', 'souffle'), os.path.join(pref, 'include')]
    for c in cands:
        if c and os.path.exists(os.path.join(c, 'souffle', 'CompiledSouffle.h')): return c
    return None


def resolve(dl):
    """a bare name ('impact.dl') against dl/; an absolute path as given."""
    if os.path.isabs(dl): return dl
    for d in (DL_DIR, HOOKS_DIR):
        p = os.path.join(d, dl)
        if os.path.exists(p): return p
    return os.path.join(DL_DIR, dl)


def program(dl, verbose=True):
    """the argv prefix to run this program: [<cached binary>], or ['souffle', <dl>] when there is no compiler, when a
    compile has already failed here (the failure is recorded, so a broken toolchain costs one attempt rather than one
    per query — the visible half of #816), or under AXIOMCODE_INTERPRET."""
    dl = resolve(dl)
    # keyed by the RULES alone. The soufflé runtime is compiled INTO the binary, so the version that generated it does
    # not matter at run time; and keying on it meant a cached (or shipped) binary was unusable without soufflé present.
    key = hashlib.sha1(open(dl, 'rb').read()).hexdigest()[:16]
    stem = os.path.splitext(os.path.basename(dl))[0]
    binp = os.path.join(CACHE, f'{stem}-{key}'); nope = binp + '.nocompile'
    if os.path.exists(binp): return [binp]
    if os.path.exists(nope) or not shutil.which('c++') or not shutil.which('souffle') or os.environ.get('AXIOMCODE_INTERPRET'):
        return ['souffle', dl]
    inc = souffle_include()
    if not inc:
        try: open(nope, 'w').write("no souffle/CompiledSouffle.h found; set AXIOM_SOUFFLE_INCLUDE to the directory CONTAINING souffle/\n")
        except OSError: pass
        print("  soufflé's headers were not found (set AXIOM_SOUFFLE_INCLUDE to the directory CONTAINING souffle/) — using the interpreter", file=sys.stderr)
        return ['souffle', dl]
    # two runs compiling the same program at once used to share one .cpp and one .tmp: the first to finish removed
    # the file under the second, which then died with "no such file". Per process names, one atomic rename.
    os.makedirs(CACHE, exist_ok=True); cpp = f"{binp}.{os.getpid()}.cpp"; out = f"{binp}.{os.getpid()}.tmp"
    if verbose: print(f"compiling {os.path.basename(dl)} to a native binary once (~20 s) …", file=sys.stderr)
    g1 = subprocess.run(['souffle', '-g', cpp, dl], capture_output=True, text=True)
    g2 = subprocess.run(['c++', '-std=c++17', '-O3', '-march=native', '-w', '-I', inc, cpp, '-o', out], capture_output=True, text=True) if g1.returncode == 0 else g1
    try: os.remove(cpp)
    except OSError: pass
    if g2.returncode == 0: os.replace(out, binp); return [binp]
    try: os.remove(out)
    except OSError: pass
    why = (g2.stderr or '').strip().split(chr(10))[-1][:200]
    # record it: without this the next query repeats the whole failed attempt, which is what made a broken probe cost
    # ~20 s on EVERY invocation instead of once (#816)
    try: open(nope, 'w').write(f"-I {inc}\n{why}\nremove this file to try again\n")
    except OSError: pass
    print(f"  could not compile ({why}) — using the interpreter; recorded in {os.path.basename(nope)}, remove it to retry", file=sys.stderr)
    return ['souffle', dl]


def all_programs():
    out = [os.path.join(DL_DIR, f) for f in sorted(os.listdir(DL_DIR)) if f.endswith('.dl')] if os.path.isdir(DL_DIR) else []
    return out


def warm(verbose=True):
    """compile every query program that is not cached yet. Called at the end of `axiomcode index`, where ~20 s each is
    noise against the build, so that no later query — least of all one under a hook's timeout — ever pays it."""
    done = []
    for dl in all_programs():
        pre = program(dl, verbose=False)
        done.append((os.path.basename(dl), 'cached' if pre and not pre[0].endswith('souffle') else 'interpreter'))
    if verbose:
        ok = sum(1 for _, s in done if s == 'cached')
        print(f"datalog rules ready: {ok}/{len(done)} compiled (" + ', '.join(f'{n}={s}' for n, s in done) + ")")
    return done


if __name__ == '__main__':
    warm()
