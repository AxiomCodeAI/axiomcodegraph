# A runtime oracle for Python

The Python suite already has a CPython oracle and it reads **bytecode**: `dis` decides
what a call site is and, from a stack model, who it names. That answers what the
**compiler** wrote down. It cannot answer what **ran** -- which `def` a name was bound to
when the call executed, which override dispatched, which decorator's wrapper stood in the
way, whether a class statement reached the metaclass.

This answers that. The two disagreeing is the point of having both.

```bash
bash trace-subject.sh --root ~/src/click --src src/click \
     --cmd '.venv/bin/python -m pytest -q tests'
```

## How it works

1. `sitecustomize.py` starts `tracer.py` at interpreter start-up, so the subject's own
   test command runs **unchanged** -- activation is two environment variables and a
   `PYTHONPATH` entry, nothing else.
2. `tracer.py` installs `sys.setprofile`. Each `call` event gives the callee's code object
   and, through `f_back.f_lineno`, the exact line the call is written on. Each `c_call`
   event gives a native callee, which `settrace` cannot see at all.
3. `join.py` folds both sides through `tools/vendor/normalize.py` -- the same module the
   engine side folds through -- and compares **per call site**.

### Why `setprofile` and not `settrace`

* `settrace` never reports a call into C, so a native callee could only be inferred from
  its absence and every `boundary_native` edge would be unscorable.
* `settrace` fires per line, paying the per-event cost on every line of the subject's
  suite for information this harness discards.
* A line event says where the interpreter is, not that a call happened.

### The integrity check

The suite is run twice, once untouched and once traced, and the two verdicts must be
identical. If tracing changes what passes, the trace describes a different program. The
check also fails when the baseline reports **no** test counts, because "identical" is
true of nothing and reads as a pass.

## The verdicts

| verdict | meaning |
|---|---|
| `agree` | the engine names, at this site, exactly what ran |
| `over_approximate` | several targets offered, the right one among them. Sound, imprecise |
| `unresolved_but_ran` | the engine accounted for the site and declared it unresolved |
| `missing_target` | the engine resolved the site and left out a target that ran |
| `wrong_target` | nothing the engine names at this site ran. A precision defect |
| `site_gap` | the site executed and the engine has no row of any kind |
| `not_executed` | the engine has the site, the suite never ran it. Not a defect |

`not_executed` is never scored. A runtime oracle can only speak about what executed.

## What it cannot see, and why that is safe

* **A construction with no Python `__init__`.** `C()` on a class without one runs
  `type.__call__` and `object.__init__`, both C slots reached by the CALL opcode itself,
  and no event fires. Those sites come out `not_executed`, which is unscored.
* **Anything the suite does not exercise.** Same bucket.

## Known subject interference

`sitecustomize` plus an active profiler is observable to a test that measures the
interpreter's own state. One CLI library asserts that importing it pulls in no module
outside an allowlist, by replacing `builtins.__import__` in a subprocess; with a profiler
active, CPython hands a materialised `f_locals` to `__import__` for a function-scope
import, that helper names its second and third parameters in the wrong order, and it
raises. Deselect such a test and say so; do not weaken the integrity check.
