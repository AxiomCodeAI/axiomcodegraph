"""A test that runs a script as a child process, by its path — the one link between them is the path it writes.

`execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js'), 'hi'])` and
`subprocess.run([sys.executable, SCRIPT])` with `SCRIPT = os.path.join(HERE, '..', 'scripts', 'report.py')` run the
script's module body in another process. No call site records that, and no import either, so everything the script
reaches looked untested: impact said `tests: 0` and test-impact selected nothing, while the test names the file.

The evidence is two things together, never one: a SPAWN VERB (a process is started) and, among its arguments, a path
that resolves to a file THIS GRAPH INDEXED. A test that only reads the same path (`fs.readFileSync(...)`, `open(...)`)
starts no process and is not linked; a path naming a file of another language is in no graph of this language and is
not linked either (a spawn across languages is not built here).

Both backends read this module (dl/impact.dl through the `spawns_fact` input, graph_sql through its edge list), so
they cannot drift apart on what counts as a spawn.
"""
import os
import re

# the process-starting calls, per language family. A bare `run(` / `call(` in Python is a spawn only where the file
# imports it from subprocess: `app.run(` and `runner.call(` are not.
SPAWN = {
    'js': re.compile(r'(?<![\w$])(?:spawnSync|spawn|execFileSync|execFile|execSync|exec|fork|execaSync|execaNode|execa)\s*\('),
    'py': re.compile(r'\bsubprocess\s*\.\s*(?:run|call|check_call|check_output|Popen|getoutput|getstatusoutput)\s*\('
                     r'|\bos\s*\.\s*(?:system|popen|exec\w*|spawn\w*)\s*\('
                     r'|\bpexpect\s*\.\s*(?:spawn|run)\s*\('
                     r'|\brunpy\s*\.\s*run_path\s*\('),
}
PY_BARE = re.compile(r'\b(run|call|check_call|check_output|Popen|run_path)\s*\(')
PY_FROM = re.compile(r'^\s*from\s+(?:subprocess|runpy)\s+import\s+([^\n]+)', re.M)
FAMILY = {'.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js', '.ts': 'js', '.tsx': 'js', '.mts': 'js', '.cts': 'js',
          '.py': 'py', '.pyi': 'py'}
TOK = re.compile(r"""'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`|([A-Za-z_$][\w$]*)""", re.S)
IMPLIED_EXT = ('.js', '.cjs', '.mjs', '.ts', '/index.js', '/index.ts', '.py', '/__main__.py')
ARGS_CAP = 1500
DEPTH = 3


def _family(f, first_line=''):
    ext = os.path.splitext(f)[1].lower()
    if ext in FAMILY: return FAMILY[ext]
    if not ext and re.match(r'#![^\n]*\bpython[0-9.]*\b', first_line or ''): return 'py'
    if not ext and re.match(r'#![^\n]*\bnode\b', first_line or ''): return 'js'
    return None


def _balanced(text, i, open_ch='(', close_ch=')'):
    """the text from i (just past an opening paren) to its matching close, strings skipped; capped"""
    depth = 1; j = i; n = min(len(text), i + ARGS_CAP); q = None
    while j < n:
        c = text[j]
        if q:
            if c == '\\': j += 2; continue
            if c == q: q = None
        elif c in '\'"`': q = c
        elif c == open_ch: depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0: return text[i:j]
        j += 1
    return text[i:j]


def _assigned(text, name):
    """the right-hand side of `name = …` in this file (const/let/var, a type annotation, or a bare Python binding)"""
    m = re.search(rf'(?m)^[ \t]*(?:export\s+)?(?:const|let|var|final)?\s*{re.escape(name)}\s*(?::[^=\n]+)?=(?!=)\s*', text)
    if not m: return None
    rest = text[m.end():m.end() + ARGS_CAP]
    out = []; depth = 0; q = None
    for c in rest:
        if q:
            out.append(c)
            if c == q: q = None
            continue
        if c in '\'"`': q = c
        elif c in '([{': depth += 1
        elif c in ')]}': depth -= 1
        elif (c == '\n' or c == ';') and depth <= 0: break
        out.append(c)
    return ''.join(out)


def _literals(text, arg, seen=(), depth=0):
    """the string pieces of an argument expression, in order: literals split on whitespace (a shell command line),
    a template literal's text and its ${…} parts, and an identifier replaced by what it is assigned in this file"""
    lits = []
    for m in TOK.finditer(arg):
        s1, s2, s3, ident = m.groups()
        if s3 is not None:
            for k, part in enumerate(re.split(r'\$\{([^}]*)\}', s3)):
                lits += _literals(text, part, seen, depth) if k % 2 else part.split()
        elif ident is not None:
            after = arg[m.end():].lstrip()[:1]
            # a receiver or a callee (`path.join`, `os.path`, `Path(`) is not a value holding the path
            if after in ('.', '(') or ident in seen or depth >= DEPTH: continue
            rhs = _assigned(text, ident)
            if rhs: lits += _literals(text, rhs, seen + (ident,), depth + 1)
        else:
            lits += (s1 if s1 is not None else s2).split()
    return lits


def _resolve(lits, f, known):
    """the indexed files a run of consecutive pieces names, tried from the test's own directory up to the root"""
    here = os.path.dirname(f).split('/') if os.path.dirname(f) else []
    bases = ['/'.join(here[:k]) for k in range(len(here), -1, -1)]
    out = set()
    for j in range(len(lits)):
        for i in range(j, max(-1, j - 7), -1):
            cand = '/'.join(p.strip('/') if k else p.rstrip('/') for k, p in enumerate(lits[i:j + 1]) if p)
            if not cand or cand.startswith('/') or cand in ('.', '..'): continue
            for b in bases:
                p = os.path.normpath(os.path.join(b, cand)) if b else os.path.normpath(cand)
                # `require.resolve('../bin/semver')`, `node bin/cli`: the runtime adds the extension, so try its own —
                # only on ONE literal that is itself a path: the middle piece of `join(ROOT, 'mcp', 'server.py')` is a
                # directory, and `mcp` + `.py` named a sibling test file that nothing runs
                if p not in known and i == j and '/' in lits[j] and not os.path.splitext(p)[1]:
                    p = next((p + e for e in IMPLIED_EXT if p + e in known), p)
                if p in known and p != f: out.add(p); break
    return out


def links(test_files, mod_of, lines, at):
    """-> sorted [(caller, script_module, file, line)]: in a test file, a spawn whose arguments name an indexed script.

    test_files: files holding a test. mod_of: {file: its module symbol} — the files this graph indexed, which is
    what keeps the link inside one language. lines(file) -> [str]; at(file, line) -> the callable around the line.
    """
    known = set(mod_of)
    out = set()
    for f in sorted(test_files):
        L = lines(f) or []
        text = '\n'.join(L)
        fam = _family(f, L[0] if L else '')
        rx = SPAWN.get(fam)
        if not rx: continue
        sites = [m.end() for m in rx.finditer(text)]
        if fam == 'py':
            bare = {n.strip().split(' as ')[-1].strip() for m in PY_FROM.finditer(text) for n in m.group(1).strip('()\\ ').split(',')}
            sites += [m.end() for m in PY_BARE.finditer(text) if m.group(1) in bare
                      and text[max(0, m.start() - 40):m.start()].rstrip()[-1:] != '.']
        for end in sorted(set(sites)):
            arg = _balanced(text, end)
            targets = _resolve(_literals(text, arg), f, known)
            if not targets: continue
            line = text.count('\n', 0, end) + 1
            c = at(f, line) or mod_of.get(f)
            if not c: continue
            for p in targets:
                if mod_of[p] != c: out.add((c, mod_of[p], f, line))
    return sorted(out)
