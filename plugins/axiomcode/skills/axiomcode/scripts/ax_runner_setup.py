"""The set-up files a JavaScript / TypeScript test runner runs before the tests it collects.

A vitest or jest configuration names files the runner loads before every test file of the project
(`setupFiles`, jest's `setupFilesAfterEnv`) and files whose exported `setup` / `teardown` (or default export) it calls
once, before anything is collected (`globalSetup`). No test file imports them and nothing calls them, so a function they
reach — a client the set-up file configures at module level, a code generator the global set-up runs — reached no test
at all, while breaking it fails every test of the run.

What is read, and nothing else: string literals in the value of those keys in a runner configuration file
(vitest.config.*, vite.config.*, vitest.workspace.*, vitest.shared.*, jest.config.*), resolved against the configuration's
directory (`<rootDir>/` and `__dirname + '/…'` included; jest's `rootDir: '..'` is honoured). A package specifier (a
library's set-up such as `@testing-library/jest-dom/vitest`) is not this repository's code and is skipped.

Which tests each file runs before:
  - setupFiles / setupFilesAfterEnv: the test files under the configuration's root (the project it configures);
  - globalSetup: every test file of the RUN — a failing global set-up aborts the whole run, every project of a
    workspace with it — so the root is the nearest directory above holding a configuration that lists projects
    (`projects:` / `workspace`, or a vitest.workspace file), else the configuration's own root.
"""
import os
import re

CONFIG_NAME = re.compile(r'^(vitest\.config|vite\.config|vitest\.workspace|vitest\.shared|jest\.config)(\.[\w-]+)*\.(c|m)?[jt]s$')
KEY = re.compile(r'\b(setupFiles|setupFilesAfterEnv|globalSetup)\s*:\s*(\[[^\]]*\]|[^,\n}]+)')
STRING = re.compile(r'''(['"`])((?:(?!\1).)*)\1''')
ROOTDIR = re.compile(r'''\brootDir\s*:\s*(['"])([^'"]*)\1''')
LISTS_PROJECTS = re.compile(r'\b(projects|workspace)\s*:\s*\[')
EXTS = ('', '.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '/index.ts', '/index.js')
SKIP_DIRS = {'node_modules', '.git', 'dist', 'build', 'coverage', '.axiomcode', '.next', 'out'}


def _configs(repo):
    for d, dirs, files in os.walk(repo):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS and not x.startswith('.')]
        for f in files:
            if CONFIG_NAME.match(f):
                yield os.path.relpath(os.path.join(d, f), repo)


def _read(repo, rel):
    try:
        with open(os.path.join(repo, rel), encoding='utf-8', errors='replace') as h: return h.read()
    except OSError:
        return ''


def _resolve(repo, base, spec, files):
    """the repository file a set-up entry names, or None (a package, or nothing there)"""
    spec = spec.replace('<rootDir>', '.')
    if not spec.startswith(('.', '/')): return None              # a package's own set-up
    rel = os.path.normpath(os.path.join(base, spec.lstrip('/') if spec.startswith('/') else spec))
    for e in EXTS:
        if (rel + e).replace(os.sep, '/') in files: return (rel + e).replace(os.sep, '/')
    return None


def setup_files(repo, files):
    """[(setup file, kind, scope dir)] for every set-up file a runner configuration here names; `files` is the set of
    repository-relative files the graph holds. kind is 'each' (setupFiles*) or 'global' (globalSetup)."""
    cfgs = sorted(_configs(repo))
    lister = {os.path.dirname(c) for c in cfgs if os.path.basename(c).startswith('vitest.workspace')
              or LISTS_PROJECTS.search(_read(repo, c))}
    out = set()
    for c in cfgs:
        text = _read(repo, c)
        if not KEY.search(text): continue
        cdir = os.path.dirname(c)
        rd = ROOTDIR.search(text)
        root = os.path.normpath(os.path.join(cdir, rd.group(2))) if rd else cdir
        root = '' if root == '.' else root
        for key, val in KEY.findall(text):
            kind = 'global' if key == 'globalSetup' else 'each'
            for _q, spec in STRING.findall(val):
                f = _resolve(repo, root if spec.startswith('<rootDir>') else cdir, spec, files)
                if f is None: continue
                scope = root
                if kind == 'global':
                    up = [d for d in lister if d == '' or scope == d or scope.startswith(d + '/')]
                    if up: scope = min(up, key=len)
                out.add((f, kind, scope))
    return sorted(out)


def in_scope(file, scope):
    return bool(file) and (scope == '' or file == scope or file.startswith(scope + '/'))
