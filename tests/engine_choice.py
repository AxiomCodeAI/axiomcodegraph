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
import json, os, re, shutil, subprocess, sys, tempfile

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


def checkout(path, label, parser):
    """an engine checkout with its own sources (parser/src) and a plugin copy in it; parser is 'built', 'missing',
    'dangling' (a link to a deleted build directory) or a directory to link parser/dist to"""
    engine(path, label, parser == 'built')
    os.makedirs(os.path.join(path, 'parser', 'src'), exist_ok=True)
    if parser == 'dangling':
        os.symlink(os.path.join(os.path.dirname(path), 'deleted-build', 'parser', 'dist'), os.path.join(path, 'parser', 'dist'))
    elif parser not in ('built', 'missing'):
        os.symlink(parser, os.path.join(path, 'parser', 'dist'))
    shutil.copytree(PLUGIN, os.path.join(path, 'plugins', 'axiomcode'))


def first_line(out):
    return (out.strip().splitlines() or [''])[0]


def says_which_engine(work, at):
    """THE FIRST LINE NAMES THE ENGINE AND PARSER, AND WHERE THEY CAME FROM. A worktree whose parser/dist linked to a
    deleted build directory was indexed with the installed engine without a word (15 of its checks then failed as if its
    fix were wrong): that is refused now; a checkout that is simply not built says loudly it is not used; a good link and
    an installed engine with no checkout around it each say one quiet line."""
    bad = []
    checkout(at('wt-dangling'), 'wt-dangling', 'dangling')
    checkout(at('wt-unbuilt'), 'wt-unbuilt', 'missing')
    checkout(at('wt-linked'), 'wt-linked', os.path.join(at('global'), 'parser', 'dist'))
    # a dangling parser/dist: refused, nothing is run, and the line names the link, where it points and the engine it avoided
    got, out = chosen(work, at('wt-dangling'), [at('pathbin')], None, 'repo', full=True)
    fl = first_line(out)
    if got != 'none': bad.append(f"a checkout whose parser/dist dangles is not built with another engine: ran {got}")
    for want in ('❌ engine:', 'parser/dist is a link to', 'does not exist', at('global'), 'AXIOMCODE_ENGINE='):
        if want not in out: bad.append(f"the refusal names {want!r}: {out[-600:]}")
    if not fl.startswith('❌ engine:'): bad.append(f"the refusal is the first line: {fl!r}")
    # asked for on purpose, AXIOMCODE_ENGINE builds with the other engine even over a dangling checkout
    got, out = chosen(work, at('wt-dangling'), [at('pathbin')], at('global'), 'repo', full=True)
    if got != 'global' or not first_line(out).startswith('engine: ') or 'AXIOMCODE_ENGINE' not in first_line(out):
        bad.append(f"AXIOMCODE_ENGINE over a dangling checkout is used, said quietly: ran {got}, {first_line(out)!r}")
    # an unbuilt checkout (parser/dist absent) falls back, and its first line says loudly that it is not this checkout's
    got, out = chosen(work, at('wt-unbuilt'), [at('pathbin')], None, 'repo', full=True)
    fl = first_line(out)
    if got != 'global': bad.append(f"an unbuilt checkout falls back to the built engine on PATH: ran {got}")
    if not (fl.startswith('⚠️  engine:') and "NOT this checkout's own" in fl and at('global') in fl and 'parser/dist is not built' in fl):
        bad.append(f"the fallback is the first line, loudly: {fl!r}")
    # control, a good link: the checkout's own engine, one quiet line naming where its parser comes from
    got, out = chosen(work, at('wt-linked'), [at('pathbin')], None, 'repo', full=True)
    fl = first_line(out)
    if got != 'wt-linked': bad.append(f"a checkout whose parser/dist links to a built parser uses itself: ran {got}")
    if not (fl.startswith('engine: this checkout') and '-> ' + os.path.realpath(os.path.join(at('global'), 'parser', 'dist')) in fl):
        bad.append(f"a good link says one quiet line naming the parser's real place: {fl!r}")
    # near-miss, installed only: a plugin copied outside any checkout, the engine on PATH: one quiet line, no warning
    got, out = chosen(work, at('cache'), [at('pathbin')], None, 'repo', full=True)
    fl = first_line(out)
    if got != 'global' or not fl.startswith('engine: ') or at('global') not in fl:
        bad.append(f"an installed run names its engine on one quiet line: ran {got}, {fl!r}")
    if '⚠' in out or '❌ engine' in out: bad.append(f"an installed run warns about nothing: {out[:400]}")
    return bad


def answers_name_the_engine():
    """the engine's origin is recorded with the graph (built_by.engine_origin), and every answer from a graph a fallback
    engine built names that engine; one built by the checkout's own or an installed engine says nothing extra"""
    bad = []
    sys.path.insert(0, os.path.join(PLUGIN, 'skills', 'axiomcode', 'scripts'))
    import ax_fresh
    os.environ['AXIOMCODE_NO_ENGINE_CHECK'] = '1'
    with tempfile.TemporaryDirectory() as work:
        eng = os.path.join(work, 'installed'); engine(eng, 'installed', True)
        open(os.path.join(eng, 'package.json'), 'w').write('{"version": "9.9.9"}')
        for origin, loud in (('fallback from /wt: parser/dist is not built there', True), ('installed', False), ('this checkout', False)):
            repo = os.path.join(work, 'r-' + origin.split()[0])
            os.makedirs(os.path.join(repo, '.axiomcode', 'out'))
            open(os.path.join(repo, 'a.py'), 'w').write('x = 1\n')
            open(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite'), 'w').close()
            os.environ['AXIOMCODE_ENGINE_ORIGIN'] = origin
            by = ax_fresh.built_by(eng)
            if by.get('engine_origin') != origin or by.get('engine') != eng:
                bad.append(f"the file table records where the engine came from: {by.get('engine_origin')!r}")
            json.dump(dict(lang='python', lang_auto=False, src='', src_arg='', library='', built=0,
                           files=ax_fresh.snapshot(repo, 'python', repo), built_by=by),
                      open(os.path.join(repo, '.axiomcode', 'out', 'files.json'), 'w'))
            r = subprocess.run([sys.executable, '-c', 'import sys; sys.path.insert(0, sys.argv[1]); import ax_fresh; '
                                'sys.exit(ax_fresh.query(sys.argv[2], "impact", [sys.executable, "-c", "print(\'answer\')"]))',
                                os.path.join(PLUGIN, 'skills', 'axiomcode', 'scripts'), repo],
                               capture_output=True, text=True, timeout=60, env=dict(os.environ, AXIOMCODE_NO_REFRESH='1'))
            said = [l for l in r.stderr.splitlines() if l.startswith('graph built by:')]
            if loud and not (said and '9.9.9' in said[0] and eng in said[0] and 'fallback from /wt' in said[0]):
                bad.append(f"an answer from a graph a fallback engine built names that engine: {r.stdout!r} {r.stderr!r}")
            if not loud and said:
                bad.append(f"an answer from a graph built by {origin!r} says nothing about the engine: {said}")
            if 'answer' not in r.stdout: bad.append(f"the answer itself is given: {r.stdout!r} {r.stderr!r}")
    os.environ.pop('AXIOMCODE_ENGINE_ORIGIN', None); os.environ.pop('AXIOMCODE_NO_ENGINE_CHECK', None)
    return bad


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
        bad += says_which_engine(work, at)
    bad += answers_name_the_engine()
    for b in bad:
        print('FAIL', b)
    print('ok' if not bad else f'{len(bad)} failure(s)')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
