"""Record, at run time, which callable actually ran at each call site.

WHAT THIS IS AND WHY IT IS NOT THE EXISTING ORACLE
The Python suite already has a CPython oracle, and it reads BYTECODE: `dis`
decides what a call site is and, from the stack model, who it names. That
answers what the COMPILER wrote down. It cannot answer what RAN -- which
`def` a name was bound to when the call executed, which override dispatched,
which decorator's wrapper stood in the way. This answers that, and the two
disagreeing is the point of having both.

WHY `setprofile` AND NOT `settrace`
Three reasons, all of them decisive:

  1. `settrace` never reports a call into C. `sys.setprofile` emits `c_call`,
     so a native callee is OBSERVED rather than inferred from its absence.
     Rule 7 of normalize.py says a native target has no anchor; without
     `c_call` the harness could not tell "called a C function" from "called
     nothing", and every `boundary_native` edge would be unscorable.
  2. `settrace` fires per LINE. The per-event cost is paid on every line of
     the subject's test suite, for information this harness discards.
  3. A line event tells you where the interpreter is, not that a call
     happened. Deriving sites from line events means guessing.

WHAT A RECORD IS. One row per (caller anchor, site line, callee) triple, with
an execution count:

    callerFile  callerLine  callerName  siteLine  calleeFile  calleeLine  calleeName  count

RAW, AND DELIBERATELY SO. Every column is what CPython reported: co_filename,
co_firstlineno, co_name, and the caller frame's f_lineno at the moment of the
call. NOTHING IS NORMALISED HERE. A decorated function's co_firstlineno points
at its first decorator and not at the `def` (Rule 1); a comprehension is its
own code object (Rule 3); module scope is a frame like any other (Rule 5).
Folding those here would bake one half of a comparison into the evidence, and
the fold is what has to be applied IDENTICALLY to both sides -- so it happens
in join.py, through the same `vendor/normalize.py` the engine side uses.

THE SITE LINE IS `f_back.f_lineno`, and that is exact rather than convenient:
at the instant a call event fires, the caller frame's instruction pointer is
still at the CALL, so its line is the line the call is written on.

SCOPE GATE. A row is kept when the caller or the callee is inside the subject
root. The stdlib calling the stdlib is not this engine's business and is the
bulk of the events; dropping it in the profile function rather than afterwards
is what keeps the overhead at a small multiple rather than a large one.

Activate it with the environment, so the subject's own test command is run
UNCHANGED (see trace-subject.sh):

    AXIOM_PY_TRACE_ROOT=<subject root>   the scope gate
    AXIOM_PY_TRACE_OUT=<directory>       one TSV per process
"""
from __future__ import annotations

import atexit
import os
import sys
import threading

__all__ = ['start', 'stop', 'dump']

_counts: dict = {}
_root: str = ''
_root_sep: str = ''
_out_dir: str = ''
_started = False


def _native_name(fn) -> str:
    """A C callee's name. Rule 7: it gets a name, never a file anchor.

    Every read is guarded. `arg` is an arbitrary object supplied by the subject, and an
    extension type may raise from `__getattr__` on any of these; an exception raised
    inside a profile function disables profiling and surfaces in the SUBJECT, which
    would break the run this harness exists to observe without changing.
    """
    try:
        mod = getattr(fn, '__module__', None)
        qual = getattr(fn, '__qualname__', None) or getattr(fn, '__name__', None) or '?'
    except Exception:
        return 'NATIVE:?'
    if not isinstance(qual, str):
        return 'NATIVE:?'
    if not isinstance(mod, str):
        mod = None
    # A method descriptor carries its class in __qualname__ already; a plain
    # builtin does not, so the module is the only thing that disambiguates
    # `time.time` from any other `time`.
    if mod and not qual.startswith(mod + '.'):
        return 'NATIVE:' + mod + '.' + qual
    return 'NATIVE:' + qual


def _profiler(frame, event, arg):
    # Local aliases: this runs millions of times. The dict lookup and the two
    # startswith calls are the whole cost model.
    if event == 'call':
        back = frame.f_back
        if back is None:
            return
        code = frame.f_code
        cfile = code.co_filename
        bcode = back.f_code
        bfile = bcode.co_filename
        if not (cfile.startswith(_root_sep) or bfile.startswith(_root_sep)):
            return
        key = (bfile, bcode.co_firstlineno, bcode.co_name, back.f_lineno,
               cfile, code.co_firstlineno, code.co_name)
    elif event == 'c_call':
        # For a C call the frame IS the caller's, and `arg` is the callee.
        code = frame.f_code
        cfile = code.co_filename
        if not cfile.startswith(_root_sep):
            return
        key = (cfile, code.co_firstlineno, code.co_name, frame.f_lineno,
               '', 0, _native_name(arg))
    else:
        return
    _counts[key] = _counts.get(key, 0) + 1


def start(root: str = '', out_dir: str = '') -> None:
    global _root, _root_sep, _out_dir, _started
    if _started:
        return
    _root = os.path.abspath(root or os.environ.get('AXIOM_PY_TRACE_ROOT', os.getcwd()))
    # Compared with startswith, so the separator has to be part of the prefix or
    # a sibling directory whose name merely starts with the root's name is let in.
    _root_sep = _root + os.sep
    _out_dir = os.path.abspath(out_dir or os.environ.get('AXIOM_PY_TRACE_OUT', '.'))
    os.makedirs(_out_dir, exist_ok=True)
    _started = True
    atexit.register(dump)
    # Threads created later; the main thread is set directly below.
    threading.setprofile(_profiler)
    sys.setprofile(_profiler)


def stop() -> None:
    sys.setprofile(None)
    threading.setprofile(None)


def dump() -> None:
    """One file per process. A test runner that forks (xdist) writes several.

    A DISPLACED PROFILER IS RECORDED, NOT SHRUGGED OFF. `sys.setprofile` holds one
    function per thread, so a subject (or a plugin, or `cProfile`) that installs its own
    silently ends this trace wherever it did so. Everything after that point is missing,
    and a missing call is indistinguishable from an engine that dropped the site -- the
    join would report false gaps and there would be nothing in the output to say why.
    The marker file makes join.py refuse the run instead.
    """
    displaced = sys.getprofile() is not None and sys.getprofile() is not _profiler
    stop()
    if displaced:
        with open(os.path.join(_out_dir, 'displaced-%d' % os.getpid()), 'w') as fh:
            fh.write('sys.setprofile was replaced while tracing; this trace is partial\n')
    if not _counts:
        return
    path = os.path.join(_out_dir, 'trace-%d.tsv' % os.getpid())
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write('callerFile\tcallerLine\tcallerName\tsiteLine'
                 '\tcalleeFile\tcalleeLine\tcalleeName\tcount\n')
        for (bf, bl, bn, sl, cf, cl, cn), n in _counts.items():
            fh.write('%s\t%d\t%s\t%d\t%s\t%d\t%s\t%d\n'
                     % (bf, bl, bn, sl, cf, cl, cn, n))
    _counts.clear()
