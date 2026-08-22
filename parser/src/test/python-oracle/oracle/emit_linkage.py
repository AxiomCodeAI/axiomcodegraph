#!/usr/bin/env python3
"""LINKAGE ORACLE — CPython's own method resolution as ground truth.

The Java side adjudicated linking with javac: the compiler says which declaration
a call actually binds to. Python has no compiler doing that, but it has something
closer to the truth — the **runtime MRO**. For a class `C` and a name `m`,
`getattr(C, m)` performs real C3 resolution and the winning function's
`__qualname__` names the class that provides it.

That makes this a genuine linker oracle for the resolution steps we care most about:

  SELF receiver      `self.m()` in class C  -> which class in C's MRO provides m
  inherited methods  the cross-module case the parser gets wrong most often
  super()            `super().m()` in C     -> the MRO slice AFTER C
  attribute types    `C.attr` at class level -> the declared object's type

It is EVIDENCE, not Gate 1. Same caveat as emit_introspection.py, and it matters:

  * IT IMPORTS THE MODULE, executing arbitrary code. Hard-scoped to the stdlib.
  * It sees the post-decoration runtime object, so a decorator that replaces a
    method changes the answer — correctly, but the source no longer shows it.
  * It can only speak about classes that import cleanly.

Usage:  emit_linkage.py --module json.decoder
        emit_linkage.py --stdlib-sample 60
        emit_linkage.py --selfcheck
"""

import argparse
import inspect
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from emit_introspection import (  # noqa: E402
    _NEVER_IMPORT, _STDLIB_ROOTS, Refused, _assert_importable,
)


def _provider(cls, name):
    """Which class in cls.__mro__ actually provides `name` — real C3, by CPython."""
    for base in cls.__mro__:
        if name in vars(base):
            return base
    return None


def _kind_of(raw):
    t = type(raw).__name__
    if t in ("staticmethod", "classmethod", "property", "cached_property"):
        return t.upper()
    if inspect.isfunction(raw):
        return "FUNCTION"
    if inspect.isbuiltin(raw) or t in ("wrapper_descriptor", "method_descriptor"):
        return "C_BUILTIN"
    return "NON_CALLABLE:" + t


def link_module(mod_name):
    """One row per (class, method-name) reachable on the class, with its provider."""
    _assert_importable(mod_name)
    import importlib
    module = importlib.import_module(mod_name)

    rows = []
    for cls_name, cls in sorted(vars(module).items()):
        if not isinstance(cls, type):
            continue
        if getattr(cls, "__module__", None) != mod_name:
            continue
        mro = [c.__qualname__ for c in cls.__mro__]
        seen = set()
        for base in cls.__mro__:
            for name, raw in vars(base).items():
                if name in seen or name.startswith("__") and name.endswith("__"):
                    continue
                seen.add(name)
                prov = _provider(cls, name)
                if prov is None:
                    continue
                rows.append({
                    "module": mod_name,
                    "class": cls_name,
                    "name": name,
                    # THE LINKAGE FACT: which class actually provides it
                    "providedBy": prov.__qualname__,
                    "providedByModule": getattr(prov, "__module__", ""),
                    "inherited": prov is not cls,
                    # is the provider inside the analysis root?
                    "providerInModule": getattr(prov, "__module__", None) == mod_name,
                    "kind": _kind_of(raw),
                    "mroDepth": mro.index(prov.__qualname__) if prov.__qualname__ in mro else -1,
                })
    return rows


def selfcheck():
    problems = []
    if sys.version_info[:2] != (3, 10):
        problems.append("expected 3.10.x, got %s" % ".".join(map(str, sys.version_info[:3])))
    for bad in ("pip", "numpy"):
        try:
            _assert_importable(bad)
            problems.append("SECURITY: did not refuse %r" % bad)
        except Refused:
            pass
        except Exception:
            pass
    # the oracle must agree with CPython on a known inheritance case
    class A:
        def m(self):
            return 1

    class B(A):
        pass

    if _provider(B, "m") is not A:
        problems.append("MRO provider lookup disagrees with CPython on a trivial case")
    return {
        "ok": not problems,
        "problems": problems,
        "provenance": {
            "interpreterPath": os.path.realpath(sys.executable),
            "sysVersion": sys.version,
            "tier": "TIER_2_LINKAGE",
            "note": "CPython MRO as the linker oracle; stdlib-scoped because it imports.",
        },
    }


def stdlib_sample(limit):
    import pkgutil
    names = []
    for root in _STDLIB_ROOTS:
        for m in pkgutil.iter_modules([root]):
            if m.name.startswith("_") or m.name in _NEVER_IMPORT:
                continue
            names.append(m.name)
    names = sorted(set(names))[:limit]
    rows, failed = [], []
    for n in names:
        try:
            rows.extend(link_module(n))
        except Refused:
            pass
        except Exception as exc:
            failed.append({"module": n, "error": "%s: %s" % (type(exc).__name__, exc)})
    inherited = sum(1 for r in rows if r["inherited"])
    cross = sum(1 for r in rows if r["inherited"] and not r["providerInModule"])
    return {
        "modulesTried": len(names),
        "links": len(rows),
        "inherited": inherited,
        "inheritedFromOutsideModule": cross,
        "importFailed": failed[:10],
        "rows": rows,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--module")
    ap.add_argument("--stdlib-sample", type=int)
    ap.add_argument("--selfcheck", action="store_true")
    ap.add_argument("--summary", action="store_true")
    a = ap.parse_args()

    if a.selfcheck:
        payload = selfcheck()
    elif a.module:
        try:
            payload = {"rows": link_module(a.module)}
        except Refused as exc:
            payload = {"refused": str(exc)}
    elif a.stdlib_sample:
        payload = stdlib_sample(a.stdlib_sample)
        if a.summary:
            payload.pop("rows", None)
    else:
        payload = {"fatal": "pass --module, --stdlib-sample or --selfcheck"}

    json.dump(payload, sys.stdout, indent=1, sort_keys=True, default=str)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
