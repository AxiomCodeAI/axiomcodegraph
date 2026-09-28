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
