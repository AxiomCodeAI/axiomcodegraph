"""dl_program.py — a Datalog program compiled to a native binary once, cached by the program's hash.

Every query program goes through here: `dl/impact.dl` (axiomcode-impact), and `dl/path*.dl` (axiomcode-path). The cache
is keyed by the RULES alone (and the machine's platform) and lives in the user's cache,
`${XDG_CACHE_HOME:-~/.cache}/axiomcode/queries/` (AXIOMCODE_QUERY_CACHE overrides it), beside the engine's own Soufflé
cache. It used to live next to the rules in `dl/.cache/`, inside the plugin: every plugin copy (an update installs a new
versioned directory; a second checkout, a worktree) then recompiled byte-identical rules, 45-140 s for impact.dl alone,
and that was paid by whichever came first, the index or a query (#1606). A binary an older plugin left in `dl/.cache/`
is still used.

A QUERY NEVER WAITS FOR A COMPILE. When the rules are not compiled yet, `program()` starts the compile in the
background (one per program per machine, under a lock) and answers this query with the Soufflé interpreter, which
derives the same relations from the same rules. The interpreter is at most ~2x slower per solve on the graphs measured;
the compile it replaces cost 45 s and more on the first question. `axiomcode index` starts the compiles when the build
starts, in parallel with the engine, so normally they are done before the graph is published.

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
import hashlib, os, platform, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
DL_DIR = os.path.join(HERE, 'dl')
LEGACY_CACHE = os.path.join(DL_DIR, '.cache')     # where a plugin before #1606 compiled to: read, never written when the user cache works
HOOKS_DIR = os.path.abspath(os.path.join(HERE, '..', '..', '..', 'hooks'))
SCOPE = '@axiomcode'   # graph/pipeline/engine.conf's ENGINE_PACKAGE_SCOPE
EXE = '.exe' if os.name == 'nt' else ''


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


def rules_id(dl):
    """what a compiled program is keyed by: its rules, and nothing else. CI names the binaries it ships with this same
    function (`dl_program.py --print-id`), so a shipped binary and a local compile agree on which rules they hold."""
    return hashlib.sha1(open(dl, 'rb').read()).hexdigest()[:16]


def npm_platform():
    """this machine in npm's spelling (process.platform-process.arch), which is how the engine packages are named"""
    o = {'darwin': 'darwin', 'win32': 'win32', 'cygwin': 'win32', 'msys': 'win32'}.get(sys.platform, 'linux' if sys.platform.startswith('linux') else None)
    a = {'x86_64': 'x64', 'amd64': 'x64', 'arm64': 'arm64', 'aarch64': 'arm64'}.get(platform.machine().lower())
    # An Intel python3 on an Apple Silicon Mac runs under Rosetta and reports x86_64, while npm, going by Node's arch,
    # installed the arm64 engine. The hardware decides: an arm64 binary runs natively even from a translated process.
    if o == 'darwin' and a == 'x64' and _sysctl('hw.optional.arm64') == '1': a = 'arm64'
    return f'{o}-{a}' if o and a else None


def _sysctl(key):
    try: return subprocess.run(['/usr/sbin/sysctl', '-n', key], capture_output=True, text=True, timeout=5).stdout.strip()
    except (OSError, subprocess.SubprocessError): return ''


def candidate_platforms():
    """the engine packages to look in, best first: this machine's, then the same OS's other architecture. npm installs
    exactly one per machine, so when the first is absent the installed one is the one npm chose for this machine."""
    plat = npm_platform()
    if not plat: return []
    o, a = plat.split('-')
    return [plat, f"{o}-{'x64' if a == 'arm64' else 'arm64'}"]


def engine_roots():
    """where the installed engine package can be found from, in order: this plugin (inside the npm package, or a
    checkout with its own node_modules), the engine named by AXIOMCODE_ENGINE, the `axiomcode` on PATH. A plugin a host
    copied under its own directory has no node_modules above it, which is why the last two exist."""
    roots = [HERE]
    if os.environ.get('AXIOMCODE_ENGINE'): roots.append(os.environ['AXIOMCODE_ENGINE'])
    # the engine that built the graph being asked (<repo>/.axiomcode/engine, recorded by axiomcode-build): the same
    # package the build used, found without PATH, which a hook or a second Node install can point elsewhere
    rec = recorded_engine()
    if rec: roots.append(rec)
    b = shutil.which('axiomcode')
    if b:
        roots.append(os.path.dirname(os.path.dirname(os.path.realpath(b))))
        # on Windows npm links the command as axiomcode.cmd / .ps1 files beside node_modules, not as a symlink into
        # the package, so realpath leads nowhere near it: the package is <that dir>/node_modules/@axiomcode/code-graph
        roots.append(os.path.join(os.path.dirname(b), 'node_modules', SCOPE, 'code-graph'))
    return roots


def recorded_engine(repo=None):
    """the engine recorded by the last build of the repository asked about: AXIOMCODE_REPO (set by the verbs once they
    know their repository), else the working directory or the nearest parent holding a .axiomcode"""
    d = os.path.realpath(repo or os.environ.get('AXIOMCODE_REPO') or os.getcwd())
    while True:
        p = os.path.join(d, '.axiomcode', 'engine')
        if os.path.isfile(p):
            try: return open(p).read().strip() or None
            except OSError: return None
        up = os.path.dirname(d)
        if up == d: return None
        d = up


def rules_unavailable(stem='impact'):
    """why the query rules cannot run on this machine, with what to do about it FOR THIS OS, or '' when they can: no
    shipped binary for these rules in any engine package found, and no soufflé to compile or interpret them"""
    if shutil.which('souffle'): return ''
    plat = npm_platform() or f'{sys.platform}-{platform.machine().lower()}'
    looked = ', '.join(dict.fromkeys(os.path.abspath(r) for r in engine_roots()))
    if sys.platform.startswith(('win', 'cygwin', 'msys')):
        fix = (f"reinstall the package so npm fetches {SCOPE}/engine-{plat} for this machine: `npm i -g @axiomcode/code-graph` "
               "(with two Node installs, run it with the Node whose global folder the plugin uses, or set AXIOMCODE_ENGINE to "
               "that package's folder); soufflé has no native Windows build")
    elif sys.platform == 'darwin':
        fix = f"`npm i -g @axiomcode/code-graph` (fetches {SCOPE}/engine-{plat}), or install soufflé: brew install souffle-lang/souffle/souffle"
    else:
        fix = f"`npm i -g @axiomcode/code-graph` (fetches {SCOPE}/engine-{plat}), or install soufflé from its releases or your distribution's package"
    return (f"no compiled {stem} rules for this version on this machine ({plat}): none of the engine packages found "
            f"(looked from: {looked}) ships them, and soufflé is not installed to build them.\n  Fix: {fix}")


def packaged(stem, key):
    """the query binary the engine package for this machine ships, when it was built from exactly these rules. Walks
    up from each root the way node resolves a package, so a local node_modules and a global install both work. A
    package holding other rules is reported once and not used — running it would answer from rules this plugin is not."""
    seen = set()
    for plat in candidate_platforms():
        for root in engine_roots():
            d = os.path.abspath(root)
            while True:
                q = os.path.join(d, 'node_modules', SCOPE, f'engine-{plat}', 'queries')
                if q not in seen and os.path.isdir(q):
                    seen.add(q)
                    binp = os.path.join(q, f'axiomcode-query-{stem}{EXE}')
                    try: have = open(os.path.join(q, f'{stem}.id')).read().strip()
                    except OSError: have = ''
                    if have == key and os.path.isfile(binp):
                        if EXE == '' and not os.access(binp, os.X_OK):
                            try: os.chmod(binp, 0o755)
                            except OSError: pass
                        return binp
                    if have: print(f"  ! {SCOPE}/engine-{plat} holds {stem}.dl at {have}, these rules are {key} — not using it", file=sys.stderr)
                up = os.path.dirname(d)
                if up == d: break
                d = up
    return None


def cache_dir():
    """where compiled query programs are kept: AXIOMCODE_QUERY_CACHE, else the user's cache (the engine's Soufflé cache
    sits beside it, see graph/pipeline/run-souffle.sh), else, with no writable HOME, the plugin's own dl/.cache"""
    ov = os.environ.get('AXIOMCODE_QUERY_CACHE')
    cands = [ov] if ov else []
    base = os.environ.get('XDG_CACHE_HOME') or (os.path.join(os.path.expanduser('~'), '.cache') if os.path.expanduser('~') != '~' else '')
    if base and not ov: cands.append(os.path.join(base, 'axiomcode', 'queries'))
    cands.append(LEGACY_CACHE)
    for d in cands:
        try:
            os.makedirs(d, exist_ok=True)
            if os.access(d, os.W_OK): return d
        except OSError: pass
    return LEGACY_CACHE


def cached_name(stem, key):
    """the file a compile of these rules is kept as. The platform is in the name because the binary is built with
    -march=native: a cache on a home directory shared by two kinds of machine must not hand one the other's binary."""
    return f"{stem}-{key}-{npm_platform() or sys.platform}{EXE}"


def _alive(pid):
    # on Windows signal 0 is CTRL_C_EVENT, not a probe: there the lock's age alone decides (LOCK_STALE_S)
    if os.name == 'nt': return True
    try: os.kill(pid, 0); return True
    except ProcessLookupError: return False
    except (PermissionError, OSError): return True


LOCK_STALE_S = 1800     # a compile that has held its lock this long is dead, whatever its pid says (pids are reused)

def _lock_holder(lock):
    """the pid compiling behind `lock`, or None when nobody is (a missing lock, or one whose holder died)"""
    try:
        pid = int(open(os.path.join(lock, 'pid')).read().strip() or 0)
        age = time.time() - os.path.getmtime(lock)
    except (OSError, ValueError):
        try: age = time.time() - os.path.getmtime(lock)
        except OSError: return None
        return -1 if age < 30 else None       # just created, pid not written yet
    return pid if pid and _alive(pid) and age < LOCK_STALE_S else None


def _take_lock(lock):
    """one compile per program per machine: mkdir is atomic. A lock left by a dead compile is taken over."""
    for _ in range(2):
        try:
            os.mkdir(lock)
            with open(os.path.join(lock, 'pid'), 'w') as fh: fh.write(str(os.getpid()))
            return True
        except FileExistsError:
            if _lock_holder(lock) is not None: return False
            shutil.rmtree(lock, ignore_errors=True)
        except OSError: return False
    return False


_ELF_MACHINE = {62: 'x64', 183: 'arm64'}
_MACHO_CPU = {0x01000007: 'x64', 0x0100000c: 'arm64'}


def runs_here(p):
    """whether the binary at p is an executable for this machine's OS and CPU, read from its header. A legacy dl/.cache
    binary is named by its rules alone, so a plugin directory copied or synced from another machine (a Mac checkout
    rsynced to a Linux VM) carries the other machine's binary under the right name, and running it was an
    `OSError: Exec format error` in the middle of impact and path. Unknown formats and unreadable headers are trusted:
    this rejects only a binary it can name as another machine's."""
    try:
        with open(p, 'rb') as fh: h = fh.read(20)
    except OSError: return False
    plat = npm_platform()
    if not plat or len(h) < 8: return True
    o, a = plat.split('-')
    if h[:4] == b'\x7fELF':
        if o != 'linux': return False
        m = _ELF_MACHINE.get(int.from_bytes(h[18:20], 'little' if h[5] == 1 else 'big')) if len(h) >= 20 else None
        return m is None or m == a
    if h[:4] in (b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe'):         # Mach-O, thin, little-endian
        if o != 'darwin': return False
        m = _MACHO_CPU.get(int.from_bytes(h[4:8], 'little'))
        return m is None or m == a
    if h[:4] in (b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca'): return o == 'darwin'   # a universal Mach-O
    if h[:2] == b'MZ': return o == 'win32'
    return True


def compiled(dl):
    """the compiled binary for these rules when one exists (the engine package's, the user cache's, or a legacy
    dl/.cache one) and runs on this machine, else None. Does no work."""
    dl = resolve(dl); key = rules_id(dl); stem = os.path.splitext(os.path.basename(dl))[0]
    shipped = packaged(stem, key)
    if shipped: return shipped
    for p in (os.path.join(cache_dir(), cached_name(stem, key)), os.path.join(LEGACY_CACHE, f'{stem}-{key}')):
        if os.path.isfile(p) and os.access(p, os.X_OK) and runs_here(p): return p
    return None


def _compile(dl, binp, nope, verbose):
    """soufflé -g, then c++; the binary lands at binp by one atomic rename. Returns True on success. A failure is
    recorded in `nope`, so a broken toolchain costs one attempt rather than one per query (the visible half of #816)."""
    inc = souffle_include()
    if not inc:
        try: open(nope, 'w').write("no souffle/CompiledSouffle.h found; set AXIOM_SOUFFLE_INCLUDE to the directory CONTAINING souffle/\n")
        except OSError: pass
        if verbose: print("  soufflé's headers were not found (set AXIOM_SOUFFLE_INCLUDE to the directory CONTAINING souffle/) — using the interpreter", file=sys.stderr)
        return False
    # per-process names and one atomic rename: two compiles of one program never share a .cpp or a .tmp
    cpp = f"{binp}.{os.getpid()}.cpp"; out = f"{binp}.{os.getpid()}.tmp"
    if verbose: print(f"compiling {os.path.basename(dl)} to a native binary once (45-140 s) …", file=sys.stderr)
    g1 = subprocess.run(['souffle', '-g', cpp, dl], capture_output=True, text=True)
    g2 = subprocess.run(['c++', '-std=c++17', '-O3', '-march=native', '-w', '-I', inc, cpp, '-o', out], capture_output=True, text=True) if g1.returncode == 0 else g1
    try: os.remove(cpp)
    except OSError: pass
    if g2.returncode == 0: os.replace(out, binp); return True
    try: os.remove(out)
    except OSError: pass
    why = (g2.stderr or '').strip().split(chr(10))[-1][:200]
    try: open(nope, 'w').write(f"-I {inc}\n{why}\nremove this file to try again\n")
    except OSError: pass
    if verbose: print(f"  could not compile {os.path.basename(dl)} ({why}) — using the interpreter; recorded in {nope}, remove it to retry", file=sys.stderr)
    return False


def _can_compile():
    return bool(shutil.which('c++') and shutil.which('souffle') and not os.environ.get('AXIOMCODE_INTERPRET'))


def start_compile(dls):
    """compile these programs in a detached process (its own session, so a caller's timeout or Ctrl-C does not kill
    it half-way, which would cache nothing and repeat on every call). Programs already compiled, failed or being
    compiled are skipped by the child. Returns at once."""
    dls = [resolve(d) for d in dls]
    if not dls or not _can_compile(): return False
    try:
        subprocess.Popen([sys.executable, os.path.abspath(__file__), '--compile'] + dls, stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)
        return True
    except OSError:
        return False


def ensure(dl, wait=True, verbose=True):
    """compile one program unless it is compiled, failed before, or being compiled by another process. With wait,
    a compile in another process is waited for. Returns the binary, or None."""
    dl = resolve(dl); key = rules_id(dl); stem = os.path.splitext(os.path.basename(dl))[0]
    have = compiled(dl)
    if have: return have
    if not _can_compile(): return None
    d = cache_dir(); binp = os.path.join(d, cached_name(stem, key)); nope = binp + '.nocompile'; lock = binp + '.lock'
    while True:
        if os.path.isfile(binp): return binp
        if os.path.exists(nope): return None
        if _take_lock(lock):
            try:
                if os.path.isfile(binp): return binp
                return binp if _compile(dl, binp, nope, verbose) else None
            finally: shutil.rmtree(lock, ignore_errors=True)
        if not wait: return None
        time.sleep(1)


_SAID = set(); _STARTED = set()     # per process: say it once, start it once

def program(dl, verbose=True):
    """the argv prefix to run this program: [<the engine package's binary>] when it was built from these rules (no
    soufflé, no compiler: what an npm install gets), else [<cached binary>], else ['souffle', <dl>]: the interpreter,
    with a compile started in the background so the next query gets the binary. A query never waits for a compile
    (see the module docstring); AXIOMCODE_INTERPRET forces the interpreter."""
    dl = resolve(dl)
    if not os.environ.get('AXIOMCODE_INTERPRET'):
        have = compiled(dl)
        if have: return [have]
        key = rules_id(dl); stem = os.path.splitext(os.path.basename(dl))[0]
        binp = os.path.join(cache_dir(), cached_name(stem, key))
        if _can_compile() and not os.path.exists(binp + '.nocompile'):
            if stem not in _STARTED and _lock_holder(binp + '.lock') is None: start_compile([dl])
            _STARTED.add(stem)
            if verbose and stem not in _SAID:
                _SAID.add(stem)
                print(f"  {stem} rules: compiling to a native binary in the background (once per machine); this answer "
                      f"uses the interpreter, same rules", file=sys.stderr)
    return ['souffle', dl]


def all_programs():
    out = [os.path.join(DL_DIR, f) for f in sorted(os.listdir(DL_DIR)) if f.endswith('.dl')] if os.path.isdir(DL_DIR) else []
    return out


def status(dl):
    """how a query would run this program now: packaged, cached, compiling, or interpreter"""
    have = compiled(dl)
    if have: return 'packaged' if os.path.basename(os.path.dirname(have)) == 'queries' and os.sep + 'node_modules' + os.sep in have else 'cached'
    dl = resolve(dl); stem = os.path.splitext(os.path.basename(dl))[0]
    binp = os.path.join(cache_dir(), cached_name(stem, rules_id(dl)))
    if _can_compile() and _lock_holder(binp + '.lock') is not None: return 'compiling'
    return 'interpreter'


def warm(verbose=True, wait=True):
    """compile every query program that is not cached yet. `axiomcode index` calls it twice: with --background when the
    build starts, so the compiles run beside the engine, and at the end to report (waiting only with wait=True).
    No query ever pays the compile: until it is done they are answered by the interpreter."""
    missing = [dl for dl in all_programs() if not compiled(dl)]
    if missing:
        if wait:
            for dl in missing: ensure(dl, wait=True, verbose=False)
        else:
            start_compile([dl for dl in missing if status(dl) != 'compiling'])
    done = [(os.path.basename(dl), status(dl)) for dl in all_programs()]
    if verbose:
        ok = sum(1 for _, s in done if s in ('cached', 'packaged'))
        print(f"datalog rules ready: {ok}/{len(done)} compiled (" + ', '.join(f'{n}={s}' for n, s in done) + ")")
        if any(s == 'compiling' for _, s in done):
            print("  the rest are compiling in the background; until they finish, queries use the interpreter (same answers)")
        # THE INTERPRETER WITHOUT SOUFFLÉ IS NOT A MODE, IT IS A FAILURE, and it has to be said here, where the index is,
        # not by the first `impact` after it: "0/4 compiled (…=interpreter)" read as a slower setting, and impact then
        # failed with advice for another operating system
        if ok < len(done) and not shutil.which('souffle'):
            why = rules_unavailable()
            print(f"⚠️  {why}\n  Until then impact answers from its SQL port (the same answers, slower on large graphs) and path from SQL, as by default.")
    return done


if __name__ == '__main__':
    if sys.argv[1:2] == ['--print-id']:
        for a in sys.argv[2:]: print(rules_id(a if os.path.exists(a) else resolve(a)))
    elif sys.argv[1:2] == ['--compile']:          # the detached child start_compile() runs
        for a in sys.argv[2:] or all_programs(): ensure(a, wait=False, verbose=False)
    elif sys.argv[1:2] == ['--background']:       # start every missing compile and return at once
        start_compile([dl for dl in all_programs() if not compiled(dl)])
    elif sys.argv[1:2] == ['--no-wait']:          # report; start what is missing; never wait
        warm(wait=False)
    else:
        warm()
