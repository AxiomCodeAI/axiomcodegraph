"""Start the tracer at interpreter start-up, so the SUBJECT'S OWN command is run unchanged.

Why not a pytest plugin, a conftest, or a `-m` wrapper: each of them changes the
command the project documents, and the integrity check this harness rests on is
that the traced run and the baseline run are the SAME run. A plugin also starts
too late -- import-time module bodies have already executed, and a module body is
a caller (Rule 5).

`sitecustomize` is imported by `site` before any user code. Putting this
directory first on PYTHONPATH is therefore the whole activation mechanism, and
the subject's command line is untouched.

IT CHAINS. A name on PYTHONPATH shadows every later one, so a subject (or a
virtualenv, or a distro) that ships its own `sitecustomize` would be silently
disabled by this file -- a change to the subject that the integrity check cannot
see, because both runs would have it. The original is located with this
directory removed from the path and executed first.
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))

# ── chain to any sitecustomize this one is shadowing ─────────────────────────
# `importlib.util.find_spec` CONSULTS sys.modules FIRST, and `sitecustomize` is in
# sys.modules while this very file is executing -- so it hands back THIS module's
# own spec and re-executing it recurses until the stack runs out. Measured: five
# nested executions and a RecursionError, after which the outermost attempt
# succeeded, so the tracer still ran and only the noise on stderr said anything
# was wrong. PathFinder searches the path and never looks at sys.modules.
_saved = list(sys.path)
sys.path[:] = [p for p in sys.path if os.path.abspath(p or os.getcwd()) != _HERE]
try:
    from importlib.machinery import PathFinder as _PathFinder
    _spec = _PathFinder.find_spec('sitecustomize', list(sys.path))
    if _spec is not None and _spec.loader is not None and _spec.origin != os.path.join(_HERE, 'sitecustomize.py'):
        import importlib.util as _ilu
        _mod = _ilu.module_from_spec(_spec)
        sys.modules['sitecustomize.original'] = _mod
        _spec.loader.exec_module(_mod)
except Exception:                                   # a broken original is the original's problem
    pass
finally:
    sys.path[:] = _saved

if os.environ.get('AXIOM_PY_TRACE_OUT'):
    sys.path.insert(0, _HERE)
    try:
        import tracer                                # noqa: E402
        tracer.start()
    except Exception as exc:                          # never take the subject down with us
        sys.stderr.write('axiom runtime oracle: tracer did not start: %r\n' % (exc,))
