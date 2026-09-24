#!/usr/bin/env python3
"""tests/engine_choice.py — axiomcode-build picks an engine that can build, wherever the plugin was installed.

Gemini CLI and Codex install from the repository, so the plugin's walk up from its own scripts ends at a
clone: bin/, graph/ and package.json present, parser/dist absent because it is not in git. That clone was
chosen over the built engine `npm i -g` put on PATH, and every build failed with "parser not built".

Each case lays out stand-in engines whose bin/axiomcode only prints its name, runs the real axiomcode-build
from a copy of the plugin, and reads which one it called.

    python3 tests/engine_choice.py
"""
import os, re, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLUGIN = os.path.join(ROOT, 'plugins', 'axiomcode')


def engine(path, label, built):
    os.makedirs(os.path.join(path, 'bin'))
    os.makedirs(os.path.join(path, 'graph'))
    open(os.path.join(path, 'package.json'), 'w').write('{}')
    exe = os.path.join(path, 'bin', 'axiomcode')
    open(exe, 'w').write(f'#!/bin/sh\necho "ENGINE={label}"\nexit 1\n')
    os.chmod(exe, 0o755)
    if built:
        os.makedirs(os.path.join(path, 'parser', 'dist'))
        open(os.path.join(path, 'parser', 'dist', 'index.js'), 'w').close()


def chosen(work, clone, path_dirs, engine_env=None):
    env = {k: v for k, v in os.environ.items() if k != 'AXIOMCODE_ENGINE'}
    env['PATH'] = os.pathsep.join(path_dirs + ['/usr/bin', '/bin'])
    if engine_env:
        env['AXIOMCODE_ENGINE'] = engine_env
    script = os.path.join(clone, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode-build')
    r = subprocess.run(['bash', script, '.'], cwd=os.path.join(work, 'repo'), env=env,
                       capture_output=True, text=True, timeout=60)
    m = re.search(r'ENGINE=([\w-]+)', r.stdout + r.stderr)
    return m.group(1) if m else 'none'


def main():
    bad = []
    with tempfile.TemporaryDirectory() as work:
        for name, built in [('clone-unbuilt', False), ('clone-built', True), ('global', True)]:
            engine(os.path.join(work, name), name, built)
        for clone in ('clone-unbuilt', 'clone-built'):
            shutil.copytree(PLUGIN, os.path.join(work, clone, 'plugins', 'axiomcode'))
        # npm links a global bin relatively: <prefix>/bin/axiomcode -> ../lib/node_modules/…/bin/axiomcode
        os.makedirs(os.path.join(work, 'pathbin'))
        os.symlink(os.path.join('..', 'global', 'bin', 'axiomcode'), os.path.join(work, 'pathbin', 'axiomcode'))
        os.makedirs(os.path.join(work, 'repo'))
        open(os.path.join(work, 'repo', 'a.py'), 'w').write('x = 1\n')
        at = lambda name: os.path.join(work, name)
        cases = [
            ('an unbuilt clone yields to a built engine on PATH', 'clone-unbuilt', [at('pathbin')], None, 'global'),
            ('a built clone is used before anything on PATH', 'clone-built', [at('pathbin')], None, 'clone-built'),
            ('an unbuilt clone is still used when it is all there is', 'clone-unbuilt', [], None, 'clone-unbuilt'),
            ('AXIOMCODE_ENGINE is used as given, built or not', 'clone-built', [at('pathbin')], at('clone-unbuilt'), 'clone-unbuilt'),
            ('an AXIOMCODE_ENGINE that is no engine falls back', 'clone-built', [at('pathbin')], at('nowhere'), 'global'),
        ]
        for why, clone, path_dirs, engine_env, want in cases:
            got = chosen(work, at(clone), path_dirs, engine_env)
            if got != want:
                bad.append(f"{why}: used {got}, want {want}")
    for b in bad:
        print('FAIL', b)
    print('ok' if not bad else f'{len(bad)} failure(s)')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
