"""FAMILY 33 — a .pyi declaration is not a call target (issue #223).

A stub is not importable: CPython's `importlib.machinery.SOURCE_SUFFIXES` is
`['.py']`, and `import accelstub` raises ModuleNotFoundError. No function object
ever exists at a name a stub declares — the implementation is elsewhere, normally a
C extension. So an edge to a stub is outside every sound envelope: not wide, WRONG.

Two shapes, and the second is the one with a runtime answer to check against.
"""
from stubbed_impl import compute


def _stub_is_not_a_target() -> int:
    """CANNOT EXECUTE, AND THAT IS THE POINT.

    `accelstub.pyi` has no `.py`, so importing it raises ModuleNotFoundError. The
    import is function-local and the name is underscored so the harness's
    coverage assertion exempts it — tier 4 can never observe this line, which is
    exactly the property under test. What pins it is expected/torture.edges: the
    site must be `boundary_lib -> external:accelstub.fast`, a NAMED boundary,
    rather than the `known_edge -> accelstub.fast` it was before the gate. A
    committed single target into a file that cannot be imported is the fabricated
    edge the design forbids.

    Named, not shrugged at: the callee is known exactly and the only reason it
    cannot be followed is that its implementation is not Python — the same
    argument resolution/builtin-types.dl makes for list.append.
    """
    from accelstub import fast

    return fast(1)


def a_real_module_beside_its_stub() -> int:
    """`stubbed_impl.py` and `stubbed_impl.pyi` both declare `compute`.

    Before the gate this site was multi_inferred over two targets — the real
    function and the stub — sound but carrying a member that cannot run, so the
    site was no longer exact. It is now a single known_edge to the `.py`, and no
    `external:` row appears because the call does not leave the Python surface.
    A live interpreter agrees: inspect.getsourcefile names the `.py`.
    """
    return compute(21)


def drive() -> str:
    return str(a_real_module_beside_its_stub())
