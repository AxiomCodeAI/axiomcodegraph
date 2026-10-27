"""ax_exec.py: hand this process over to another program, on every platform (#1640).

On POSIX os.execv* replaces the running process: the caller waiting on this pid gets the program's output and its
exit status. ON WINDOWS IT DOES NOT. The C runtime starts the program as a NEW process and ends this one at once with
status 0, so whoever started this one (bash's `exec python3 ax_fresh.py …`, the MCP server, a hook) sees a success
with no output before the program has written a line, and its answer lands nowhere anyone reads. Every `impact`,
`path` and `context` through the dispatcher answered nothing and exited 0 on Windows.

So on Windows the program is run as a child and this process exits with its status; elsewhere it is exec'd, which
keeps the one process (a signal or a timeout's kill reaches the program itself). A verb script named by `python3` or
`python` is run by this interpreter: on Windows that name can be pyshim/python3, a shell script no native process
can start (#1331), and this interpreter is the one that name was resolved to for this very process.

REPLACES is read at call time, so a test can take the Windows branch on any OS (tests/no_exec.py).
"""
import os, subprocess, sys

REPLACES = os.name != 'nt'


def program(argv):
    """argv with a leading python3 / python replaced by this interpreter"""
    if argv and os.path.basename(argv[0]).lower() in ('python3', 'python', 'python3.exe', 'python.exe'):
        return [sys.executable] + list(argv[1:])
    return list(argv)


def become(argv):
    """run argv in this process's place and never return: exec where exec replaces, else run it and exit with its status"""
    argv = program(argv)
    sys.stdout.flush(); sys.stderr.flush()
    if REPLACES:
        os.execv(argv[0], argv) if os.path.isabs(argv[0]) else os.execvp(argv[0], argv)
    try:
        rc = subprocess.run(argv).returncode
    except KeyboardInterrupt:
        rc = 130
    sys.exit(rc)


ARGV_ENV = 'AXIOMCODE_ARGV'


def bash_argv(script, args, env=None, bash=None):
    """(argv, env) that run the bash script `script` with exactly `args`. ON WINDOWS THE COMMAND LINE CANNOT CARRY THEM:
    Git Bash's msys runtime parses it by its own rules, where `'` quotes too and `\\"` is no escape, so `it's` swallowed
    every argument after it and `"Widgets:MinCount"` arrived as `\\Widgets:MinCount\\`. There they travel in
    AXIOMCODE_ARGV, each ended by \\x1f, and the script's prologue turns them back into "$@": an environment value
    reaches bash as written. Elsewhere they are passed on the command line as before. WINDOWS_ARGV is read at call time,
    so a test can take the Windows branch on any OS."""
    bash = bash or os.environ.get('AXIOMCODE_BASH') or 'bash'
    if not WINDOWS_ARGV: return [bash, script, *args], env
    e = dict(os.environ if env is None else env); e[ARGV_ENV] = ''.join(f'{a}\x1f' for a in args)
    return [bash, script], e


WINDOWS_ARGV = os.name == 'nt'
