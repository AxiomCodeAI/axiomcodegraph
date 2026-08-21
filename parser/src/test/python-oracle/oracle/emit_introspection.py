#!/usr/bin/env python3
"""TIER 2 — Introspection-adjudicated evidence for typeCategory / typeModifier /
methodKind.

WEAKER THAN TIER 1, AND THE DIFFERENCE IS NOT COSMETIC. Tier 1 reads a parse
tree. This imports the module and asks the objects, which means:

  * IT EXECUTES ARBITRARY MODULE-LEVEL CODE. Hard-scoped to the standard library
    below; it refuses anything else. Never point it at the mined corpus.
  * It sees the POST-DECORATION runtime object, not the source. A class that
    fails to import is invisible; a decorator that replaces a function makes the
    original undetectable.
  * It cannot see @overload stubs on 3.10 (typing.get_overloads is 3.11+), and
    it cannot see @typing.final (which sets no attribute before 3.11).

So this is Gate 1 WITH A STATED CAVEAT, not Gate 1. Where several categories
apply at once it emits ALL of them and flags the collision rather than picking a
winner — the priority order is a spec decision and belongs in
python-work/FIELD-CLASSIFICATION-SPEC.md, not smuggled in here.

Usage:  emit_introspection.py --module json.decoder
        emit_introspection.py --stdlib-sample 40
        emit_introspection.py --selfcheck
"""

import abc
import argparse
import dataclasses
import enum
import functools
import inspect
import json
import os
import pkgutil
import sys
import sysconfig
import typing

EMISSION_REGIME = "PY3_0_11"

#: The ONLY roots this tool will import from. Importing executes module-level
#: code, so this is a security boundary, not a convenience.
_STDLIB_ROOTS = tuple(
    os.path.realpath(p)
    for p in {sysconfig.get_paths().get("stdlib"), sysconfig.get_paths().get("platstdlib")}
    if p
)

#: Even inside the stdlib, these run side effects or rewrite global state on
#: import. Excluded by name.
_NEVER_IMPORT = {
    "antigravity", "this", "idlelib", "turtle", "turtledemo", "tkinter",
    "lib2to3", "test", "site", "rlcompleter", "pydoc", "doctest",
    "__main__", "ensurepip", "venv", "curses", "asyncio.windows_events",
    "multiprocessing.popen_spawn_win32", "encodings.idna",
}


class Refused(Exception):
    pass


def _assert_importable(mod):
    """Refuse anything that is not plainly stdlib. Fail closed."""
    top = mod.split(".")[0]
    if top in _NEVER_IMPORT or mod in _NEVER_IMPORT:
        raise Refused("module %r is on the never-import list" % mod)
    spec = None
    try:
        import importlib.util
        spec = importlib.util.find_spec(mod)
    except Exception as exc:
        raise Refused("cannot resolve %r: %s" % (mod, exc))
    if spec is None:
        raise Refused("no spec for %r" % mod)
    origin = getattr(spec, "origin", None)
    if origin in ("built-in", "frozen"):
        return  # C builtins execute no Python module body
    if not origin:
        raise Refused("no origin for %r (namespace package?)" % mod)
    real = os.path.realpath(origin)
    if not any(real.startswith(root + os.sep) for root in _STDLIB_ROOTS):
        raise Refused(
            "REFUSED: %r resolves to %s, which is outside the stdlib roots %s. "
            "Introspection executes module code and is stdlib-scoped by design."
            % (mod, real, list(_STDLIB_ROOTS)))
    if "site-packages" in real or "dist-packages" in real:
        raise Refused("REFUSED: %r is third-party (%s)" % (mod, real))


# ---------------------------------------------------------------------------
# typeCategory — ALL applicable categories, plus a collision flag. No winner.
# ---------------------------------------------------------------------------

def type_categories(cls):
    cats = []
    if dataclasses.is_dataclass(cls):
        cats.append("DATACLASS_TYPE")
    if isinstance(cls, enum.EnumMeta):
        cats.append("ENUM_CLASS_TYPE")
    if getattr(cls, "_is_protocol", False):
        cats.append("PROTOCOL_TYPE")
    try:
        if typing.is_typeddict(cls):
            cats.append("TYPEDDICT_TYPE")
    except Exception:
        pass
    if isinstance(cls, type) and issubclass(cls, tuple) and hasattr(cls, "_fields"):
        cats.append("NAMEDTUPLE_TYPE")
    # NO priority filtering here. A Protocol genuinely IS an ABCMeta instance
    # and a Generic subclass; reporting only "PROTOCOL_TYPE" would be smuggling
    # a precedence decision into tier 2. Report every predicate that holds and
    # let the collision flag fire — the winner is a SPEC question.
    if isinstance(cls, abc.ABCMeta):
        cats.append("ABC_TYPE")
    if isinstance(cls, type) and issubclass(cls, BaseException):
        cats.append("EXCEPTION_CLASS_TYPE")
    if isinstance(cls, type) and issubclass(cls, type):
        cats.append("METACLASS_TYPE")
    if typing.Generic in getattr(cls, "__mro__", ()):
        cats.append("GENERIC_TYPE")
    return cats or ["CLASS_TYPE"]


def type_modifiers(cls):
    """8 of the 10 legal values. FINAL and CALLABLE_INSTANCE are NOT here:

    FINAL             typing.final sets no attribute before 3.11 (verified on
                      3.10.4) -> tier 1, ast only.
    CALLABLE_INSTANCE overlaps HAS_CALL entirely and has no distinct definition
                      in the schema -> filed for A3, not guessed here.
    """
    d = getattr(cls, "__dict__", {})
    mods = []
    if getattr(cls, "__abstractmethods__", None):
        mods.append("ABSTRACT")
    elif isinstance(cls, abc.ABCMeta):
        mods.append("ABSTRACT")
    params = getattr(cls, "__dataclass_params__", None)
    if params is not None and getattr(params, "frozen", False):
        mods.append("FROZEN")
    if "__slots__" in d:
        mods.append("SLOTS")
    if typing.Generic in getattr(cls, "__mro__", ()):
        mods.append("GENERIC")
    if getattr(cls, "_is_runtime_protocol", False):
        mods.append("RUNTIME_CHECKABLE")
    if "__getattr__" in d or "__getattribute__" in d:
        mods.append("HAS_GETATTR")
    if "__setattr__" in d:
        mods.append("HAS_SETATTR")
    if "__call__" in d:
        mods.append("HAS_CALL")
    return sorted(set(mods))


# ---------------------------------------------------------------------------
# methodKind — the descriptor-decided subset only.
# ---------------------------------------------------------------------------

def method_kinds(cls):
    """What the class __dict__ descriptor proves, and nothing more.

    Reads __dict__ DIRECTLY rather than via getattr/inspect.getmembers, because
    attribute access invokes descriptors and would run user code.
    """
    out = []
    for name, raw in sorted(vars(cls).items()):
        t = type(raw)
        kind, roles = None, []
        if t is staticmethod:
            kind = "STATIC_METHOD"
        elif t is classmethod:
            kind = "CLASS_METHOD"
        elif t is property:
            kind = "PROPERTY_GETTER"
            for role, fn in (("PROPERTY_GETTER", raw.fget),
                             ("PROPERTY_SETTER", raw.fset),
                             ("PROPERTY_DELETER", raw.fdel)):
                if fn is not None and hasattr(fn, "__code__"):
                    # all three share the NAME; only the def line separates them
                    roles.append({"role": role, "defLine": fn.__code__.co_firstlineno})
        elif t is functools.cached_property:
            kind = "CACHED_PROPERTY"
        elif inspect.isfunction(raw):
            fn = raw
            if inspect.isasyncgenfunction(fn):
                kind = "ASYNC_GENERATOR"
            elif inspect.iscoroutinefunction(fn):
                kind = "ASYNC_FUNCTION"
            elif inspect.isgeneratorfunction(fn):
                kind = "GENERATOR"
            else:
                kind = "INSTANCE_METHOD"
        if kind is None:
            continue
        entry = {"name": name, "descriptorKind": kind,
                 "isAbstract": bool(getattr(raw, "__isabstractmethod__", False))}
        if roles:
            entry["propertyRoles"] = roles
        fn = getattr(raw, "__func__", None) or getattr(raw, "func", None) or (
            raw.fget if t is property else raw if inspect.isfunction(raw) else None)
        if fn is not None and hasattr(fn, "__code__"):
            entry["defLine"] = fn.__code__.co_firstlineno
        out.append(entry)
    return out


def describe_module(mod_name):
    _assert_importable(mod_name)
    import importlib
    module = importlib.import_module(mod_name)
    rows = []
    for name, obj in sorted(vars(module).items()):
        if not isinstance(obj, type):
            continue
        if getattr(obj, "__module__", None) != mod_name:
            continue  # only classes DECLARED here
        cats = type_categories(obj)
        rows.append({
            "module": mod_name,
            "class": name,
            "defLine": _safe_line(obj),
            "typeCategoryCandidates": cats,
            "categoryCollision": len(cats) > 1,
            "typeModifier": type_modifiers(obj),
            "methods": method_kinds(obj),
        })
    return rows


def _safe_line(obj):
    try:
        return inspect.getsourcelines(obj)[1]
    except Exception:
        return None


def selfcheck():
    problems = []
    if sys.version_info[:2] != (3, 10):
        problems.append("expected 3.10.x, got %s" % ".".join(map(str, sys.version_info[:3])))
    if not _STDLIB_ROOTS:
        problems.append("could not determine stdlib roots")
    # the boundary must actually refuse
    for bad in ("numpy", "sqlalchemy", "pytest"):
        try:
            _assert_importable(bad)
            problems.append("SECURITY: did not refuse third-party module %r" % bad)
        except Refused:
            pass
        except Exception:
            pass
    # and must allow plain stdlib
    try:
        _assert_importable("json.decoder")
    except Refused as exc:
        problems.append("wrongly refused stdlib json.decoder: %s" % exc)
    # verified capability gaps that drive the tiering
    gaps = {
        "typing.get_overloads": hasattr(typing, "get_overloads"),
        "typing.final sets __final__": hasattr(typing.final(lambda: None), "__final__"),
    }
    return {"ok": not problems, "problems": problems, "capabilityGaps": gaps,
            "stdlibRoots": list(_STDLIB_ROOTS),
            "provenance": {"interpreterPath": os.path.realpath(sys.executable),
                           "sysVersion": sys.version,
                           "emissionRegime": EMISSION_REGIME,
                           "tier": "TIER_2_INTROSPECTION"}}


def stdlib_sample(limit):
    """A deterministic slice of importable stdlib modules."""
    names = []
    for root in _STDLIB_ROOTS:
        for m in pkgutil.iter_modules([root]):
            if m.name.startswith("_") or m.name in _NEVER_IMPORT:
                continue
            names.append(m.name)
    names = sorted(set(names))[:limit]
    rows, refused, failed = [], [], []
    for n in names:
        try:
            rows.extend(describe_module(n))
        except Refused as exc:
            refused.append({"module": n, "reason": str(exc)})
        except Exception as exc:
            failed.append({"module": n, "error": "%s: %s" % (type(exc).__name__, exc)})
    return {"rows": rows, "refused": refused, "importFailed": failed,
            "modulesTried": len(names)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--module")
    ap.add_argument("--stdlib-sample", type=int)
    ap.add_argument("--selfcheck", action="store_true")
    args = ap.parse_args()

    if args.selfcheck:
        payload = selfcheck()
    elif args.module:
        try:
            payload = {"rows": describe_module(args.module)}
        except Refused as exc:
            payload = {"refused": str(exc)}
    elif args.stdlib_sample:
        payload = stdlib_sample(args.stdlib_sample)
    else:
        payload = {"fatal": "pass --module, --stdlib-sample or --selfcheck"}

    json.dump(payload, sys.stdout, indent=1, sort_keys=True, default=str)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
