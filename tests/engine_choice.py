#!/usr/bin/env python3
"""tests/engine_choice.py — axiomcode-build picks an engine that can build, wherever the plugin was installed.

Gemini CLI and Codex install from the repository, so the plugin's walk up from its own scripts ends at a
clone: bin/, graph/ and package.json present, parser/dist absent because it is not in git. That clone was
chosen over the built engine `npm i -g` put on PATH, and every build failed with "parser not built".

Each case lays out stand-in engines whose bin/axiomcode only prints its name, runs the real axiomcode-build
from a copy of the plugin, and reads which one it called. The refresh after an edit runs the same script from a hook,
with the hook's PATH (a second Node install, npm's .cmd/.sh shims on Windows): the engine the last build used is
recorded in .axiomcode/engine and found before PATH, and a build that finds none says everywhere it looked.

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


def chosen(work, clone, path_dirs, engine_env=None, repo='repo', full=False):
    env = {k: v for k, v in os.environ.items() if k != 'AXIOMCODE_ENGINE'}
    env['PATH'] = os.pathsep.join(path_dirs + ['/usr/bin', '/bin'])
    if engine_env:
        env['AXIOMCODE_ENGINE'] = engine_env
    script = os.path.join(clone, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode-build')
    r = subprocess.run(['bash', script, '.'], cwd=os.path.join(work, repo), env=env,
                       capture_output=True, text=True, timeout=60)
    m = re.search(r'ENGINE=([\w-]+)', r.stdout + r.stderr)
    got = m.group(1) if m else 'none'
    return (got, r.stdout + r.stderr) if full else got


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
        # a plugin a host COPIED outside any checkout (a marketplace cache): nothing above it is an engine
        shutil.copytree(PLUGIN, os.path.join(work, 'cache', 'plugins', 'axiomcode'))
        # the engine a previous build of this repository used, recorded by that build (.axiomcode/engine)
        engine(at('recorded'), 'recorded', True)
        os.makedirs(os.path.join(work, 'repo-rec', '.axiomcode'))
        open(os.path.join(work, 'repo-rec', 'a.py'), 'w').write('x = 1\n')
        open(os.path.join(work, 'repo-rec', '.axiomcode', 'engine'), 'w').write(at('recorded') + '\n')
        # npm on Windows: the command is a SHIM file in npm's prefix, not a symlink, with the package beside it
        engine(os.path.join(work, 'npmprefix', 'node_modules', '@axiomcode', 'code-graph'), 'shim', True)
        open(os.path.join(work, 'npmprefix', 'axiomcode'), 'w').write('#!/bin/sh\nexec node "$(dirname "$0")/node_modules/@axiomcode/code-graph/bin/axiomcode.js" "$@"\n')
        os.chmod(os.path.join(work, 'npmprefix', 'axiomcode'), 0o755)
        cases = [
            ('an unbuilt clone yields to a built engine on PATH', 'clone-unbuilt', [at('pathbin')], None, 'global', 'repo'),
            ('a built clone is used before anything on PATH', 'clone-built', [at('pathbin')], None, 'clone-built', 'repo'),
            ('an unbuilt clone is still used when it is all there is', 'clone-unbuilt', [], None, 'clone-unbuilt', 'repo'),
            ('AXIOMCODE_ENGINE is used as given, built or not', 'clone-built', [at('pathbin')], at('clone-unbuilt'), 'clone-unbuilt', 'repo'),
            # the plugin's own checkout, then PATH: the same order as when AXIOMCODE_ENGINE is not set at all
            ('an AXIOMCODE_ENGINE that is no engine falls back to the plugin\'s own checkout', 'clone-built', [at('pathbin')], at('nowhere'), 'clone-built', 'repo'),
            ('an AXIOMCODE_ENGINE that is no engine falls back to PATH from a copied plugin', 'cache', [at('pathbin')], at('nowhere'), 'global', 'repo'),
            # the refresh after an edit runs from a hook, with the hook's PATH: the engine of the last build still answers
            ('a copied plugin with nothing on PATH uses the engine that built this graph', 'cache', [], None, 'recorded', 'repo-rec'),
            ('the recorded engine comes before PATH, which a second Node install can point elsewhere', 'cache', [at('pathbin')], None, 'recorded', 'repo-rec'),
            # control: the recorded engine never overrides the plugin's own built checkout, nor AXIOMCODE_ENGINE
            ('the plugin\'s own built checkout comes before the recorded engine', 'clone-built', [], None, 'clone-built', 'repo-rec'),
            ('AXIOMCODE_ENGINE comes before the recorded engine', 'cache', [], at('global'), 'global', 'repo-rec'),
            ('a Windows-style npm shim on PATH leads to the package beside it', 'cache', [at('npmprefix')], None, 'shim', 'repo'),
        ]
        for why, clone, path_dirs, engine_env, want, repo in cases:
            got = chosen(work, at(clone), path_dirs, engine_env, repo)
            if got != want:
                bad.append(f"{why}: used {got}, want {want}")
        # FOUND NOTHING: the build fails and names every place it looked, in order, and why each was not an engine
        got, out = chosen(work, at('cache'), [], at('nowhere'), 'repo', full=True)
        for want in ('no engine found', 'is not an engine checkout', 'AXIOMCODE_ENGINE: ', "this plugin's checkout: none above",
                     'axiomcode on PATH: none'):
            if want not in out:
                bad.append(f"with no engine anywhere, the message names {want!r}: {out[-600:]}")
        if got != 'none':
            bad.append(f"with no engine anywhere, nothing is run: ran {got}")
    for b in bad:
        print('FAIL', b)
    print('ok' if not bad else f'{len(bad)} failure(s)')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
