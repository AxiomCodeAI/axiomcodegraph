#!/usr/bin/env python3
"""tests/windows_argv.py: an argument holding ' or " reaches the verb as written when started the Windows way.

A native program (bin/axiomcode.js, the MCP server, a build Python starts) cannot hand Git Bash its arguments on a
command line: the msys runtime parses one by its own rules, where `'` quotes too and `\\"` is no escape. So on Windows
`context "how does the user's cart work"` lost every argument after the apostrophe, and `impact '"Widgets:MinCount"'`
asked for `\\Widgets:MinCount\\`. There the arguments travel in AXIOMCODE_ARGV (ax_exec.bash_argv) and each bash
entry point turns them back into "$@". This takes that Windows branch on any OS (ax_exec.WINDOWS_ARGV) through both
entry points, with a repository argument the dispatcher names back when it does not exist.

Checks:
  each entry point names back an argument with ', ", a space and a backslash exactly, through AXIOMCODE_ARGV
  an empty argument and one with a newline keep their place: the argument after them is still the repository
  the variable is taken once: a script the entry point starts does not see it (the build would re-read the CLI's args)
  control: the command-line branch (every other OS) answers the same
"""
import os, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts')
sys.path.insert(0, SCRIPTS)
import ax_exec

ENTRIES = {'dispatcher': os.path.join(SCRIPTS, 'axiomcode'), 'bin': os.path.join(ROOT, 'bin', 'axiomcode')}
fails = total = 0


def check(why, ok, detail=''):
    global fails, total
    total += 1
    if not ok: fails += 1; print(f"FAIL {why}\n     {detail}")


def run(entry, args, windows):
    ax_exec.WINDOWS_ARGV = windows
    argv, env = ax_exec.bash_argv(entry, args, dict(os.environ))
    r = subprocess.run(argv, env=env, capture_output=True, text=True, timeout=120)
    return r.stdout + r.stderr


with tempfile.TemporaryDirectory() as tmp:
    odd = os.path.join(tmp, 'no such \'repo\' "q" a\\b')            # never created: the dispatcher names it back
    for name, entry in ENTRIES.items():
        for windows in (True, False):
            how = 'AXIOMCODE_ARGV' if windows else 'the command line'
            out = run(entry, ['impact', 'foo', odd], windows)
            check(f"{name}: an argument with ', \", a space and a backslash arrives as written through {how}",
                  f"no such directory: {odd}" in out, out[-300:])
            out = run(entry, ['impact', '', odd], windows) if name == 'dispatcher' else ''
            if name == 'dispatcher':
                check(f"{name}: an empty argument keeps its place through {how}", f"no such directory: {odd}" in out, out[-300:])
                out = run(entry, ['impact', 'a\nb', odd], windows)
                check(f"{name}: an argument with a newline keeps its place through {how}", f"no such directory: {odd}" in out, out[-300:])

    # taken once: an entry point that sets the variable for itself would hand the CLI's arguments to every script it
    # starts. A probe script beside the dispatcher prints what it was given and whether the variable reached it.
    probe = os.path.join(tmp, 'probe.sh')
    with open(probe, 'w') as h:
        h.write(open(ENTRIES['dispatcher']).read().split('\n', 1)[0] + '\n')
        src = open(ENTRIES['dispatcher']).read()
        start = src.index('if [ -n "${AXIOMCODE_ARGV+x}" ]; then'); end = src.index('\nfi\n', start) + 4
        h.write(src[start:end])
        h.write('printf "<%s>" "$@"; echo; bash -c \'echo "child=${AXIOMCODE_ARGV-unset}"\'\n')
    ax_exec.WINDOWS_ARGV = True
    argv, env = ax_exec.bash_argv(probe, ["it's", '"x"'], dict(os.environ))
    out = subprocess.run(argv, env=env, capture_output=True, text=True).stdout
    check("the prologue rebuilds \"$@\" exactly", "<it's><\"x\">" in out, out)
    check("the variable is taken once: a script started after it does not see it", "child=unset" in out, out)

print(f"{total - fails} of {total} check(s) held" if not fails else f"{fails} of {total} FAILED")
sys.exit(1 if fails else 0)
