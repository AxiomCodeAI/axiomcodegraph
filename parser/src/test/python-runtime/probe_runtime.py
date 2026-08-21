"""Runtime adjudicator for the fields no static oracle covers.

Gate 1 is `symtable` (exact). Gate 2 is `ast` (a second STATIC implementation,
written by the harness author, so it shares that author's blind spots). This is a
THIRD source and a different kind of evidence: it imports the module and asks
the **live objects** what they are, using CPython's own introspection.

That difference is the whole point. `typeCategory`, `typeModifier` and
`methodKind` are derived by the parser from syntax — bases, decorators, keyword
arguments. The runtime knows the ANSWER without looking at syntax at all:
`dataclasses.is_dataclass`, `inspect.isabstract`, `issubclass(cls, enum.Enum)`.
So a shared premise between the parser and a static checker cannot hide here.

Emits, per class and per function DEFINED IN THIS MODULE (inherited and imported
objects are skipped, since they are not this module's facts):

  classes[]:  name, line, runtimeCategories[], runtimeModifiers[]
  functions[]: name, line, qualname, runtimeKind, isAbstract

`runtimeCategories` is a SET, not a single winner. Precedence between, say,
DATACLASS_TYPE and EXCEPTION_CLASS_TYPE is a modelling choice the runtime does
not make, so this reports every signal that genuinely applies and lets the
comparison assert membership rather than pretending to adjudicate ordering.
"""
import argparse
import dataclasses
import enum
import importlib.util
import inspect
import json
import sys
import typing


def _abcmeta_introduced_here(cls):
    """Whether ABCMeta appears to be introduced BY this class.

    Merely descending from an ABC does not make a class abstract:
    `contextlib.closing(AbstractContextManager)` inherits ABCMeta but is a
    perfectly concrete context manager, and `inspect.isabstract` agrees it is
    not abstract. Treating any ABCMeta in the metaclass MRO as ABC_TYPE marks
    every subclass of every ABC as abstract, which is both wrong and unhelpful.
    """
    if "ABCMeta" not in {m.__name__ for m in getattr(type(cls), "__mro__", ())}:
        return False
    for base in getattr(cls, "__bases__", ()):
        if "ABCMeta" in {m.__name__ for m in getattr(type(base), "__mro__", ())}:
            return False
    return True


def _mro_names(cls):
    """Names of every class in the MRO, plus the metaclass MRO.

    Compared by NAME rather than identity on purpose. Importing a module from a
    path creates class objects unrelated to the canonical ones, so
    `issubclass(freshly_imported_Enum, enum.Enum)` is False and an identity check
    silently reports that `enum.Enum` is not an enum. That flaw was found by
    running this probe against enum.py itself.
    """
    names = set()
    for base in getattr(cls, "__mro__", ()):
        names.add(base.__name__)
    for meta in getattr(type(cls), "__mro__", ()):
        names.add(meta.__name__)
    return names


def _categories(cls):
    """Every category signal that genuinely applies, from live objects."""
    found = []
    names = _mro_names(cls)
    if dataclasses.is_dataclass(cls):
        found.append("DATACLASS_TYPE")
    if getattr(cls, "_is_protocol", False):
        found.append("PROTOCOL_TYPE")
    try:
        if typing.is_typeddict(cls):
            found.append("TYPEDDICT_TYPE")
    except Exception:
        pass
    # A NamedTuple is a tuple subclass carrying _fields.
    if isinstance(cls, type) and issubclass(cls, tuple) and hasattr(cls, "_fields"):
        found.append("NAMEDTUPLE_TYPE")
    if names & {"Enum", "IntEnum", "StrEnum", "Flag", "IntFlag", "EnumMeta", "EnumType"}:
        found.append("ENUM_CLASS_TYPE")
    if isinstance(cls, type) and issubclass(cls, type):
        found.append("METACLASS_TYPE")
    if isinstance(cls, type) and issubclass(cls, BaseException):
        found.append("EXCEPTION_CLASS_TYPE")
    # inspect.isabstract is true only when abstract methods REMAIN unimplemented,
    # so also accept an ABCMeta metaclass, which is what the syntax expresses.
    # Abstract because it declares unimplemented abstract methods, or because it
    # is the class that introduces ABCMeta. NOT merely because an ancestor did.
    if inspect.isabstract(cls) or _abcmeta_introduced_here(cls):
        found.append("ABC_TYPE")
    if getattr(cls, "__parameters__", None) or "Generic" in names:
        found.append("GENERIC_TYPE")
    return found


def _modifiers(cls):
    """Modifier signals the runtime can confirm independently of syntax."""
    found = []
    own = vars(cls)
    if "__slots__" in own:
        found.append("SLOTS")
    if dataclasses.is_dataclass(cls):
        params = getattr(cls, "__dataclass_params__", None)
        if params is not None and getattr(params, "frozen", False):
            found.append("FROZEN")
    if getattr(cls, "_is_runtime_protocol", False):
        found.append("RUNTIME_CHECKABLE")
    if inspect.isabstract(cls) or _abcmeta_introduced_here(cls):
        found.append("ABSTRACT")
    if getattr(cls, "__parameters__", None) or getattr(cls, "_is_protocol", False):
        found.append("GENERIC")
    # Escape hatches: only when defined ON this class, matching what the parser
    # can see in the class body.
    if "__getattr__" in own or "__getattribute__" in own:
        found.append("HAS_GETATTR")
    if "__setattr__" in own:
        found.append("HAS_SETATTR")
    if "__call__" in own:
        found.append("HAS_CALL")
        found.append("CALLABLE_INSTANCE")
    if getattr(cls, "__final__", False):
        found.append("FINAL")
    return found


def _method_kind(owner, name, raw, func):
    """The runtime's own answer for what kind of callable this is.

    `__new__` is checked FIRST: Python makes it a staticmethod implicitly, so an
    isinstance check would report STATIC_METHOD, but the schema designates the
    more specific ALLOCATOR for it. Same for the two implicit classmethods.
    """
    if name == "__new__":
        return "ALLOCATOR"
    if name in ("__init_subclass__", "__class_getitem__"):
        return "CLASS_METHOD"
    if isinstance(raw, staticmethod):
        return "STATIC_METHOD"
    if isinstance(raw, classmethod):
        return "CLASS_METHOD"
    if isinstance(raw, property):
        return "PROPERTY_GETTER"
    if getattr(func, "__isabstractmethod__", False):
        return "ABSTRACT_METHOD"
    if inspect.isasyncgenfunction(func):
        return "ASYNC_GENERATOR"
    if inspect.iscoroutinefunction(func):
        return "ASYNC_FUNCTION"
    if inspect.isgeneratorfunction(func):
        return "GENERATOR"
    if name == "__init__":
        return "CONSTRUCTOR"
    if name.startswith("__") and name.endswith("__"):
        return "DUNDER_METHOD"
    if owner is None:
        return "FUNCTION"
    return "INSTANCE_METHOD"


def _unwrap(raw):
    if isinstance(raw, (staticmethod, classmethod)):
        return raw.__func__
    if isinstance(raw, property):
        return raw.fget
    return raw


def _line(obj):
    try:
        return inspect.getsourcelines(obj)[1]
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--module-name", default="_probe_target")
    args = ap.parse_args()

    spec = importlib.util.spec_from_file_location(args.module_name, args.file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[args.module_name] = module
    spec.loader.exec_module(module)

    classes, functions = [], []

    for name, obj in vars(module).items():
        if inspect.isclass(obj) and obj.__module__ == module.__name__:
            classes.append({
                "name": name,
                "line": _line(obj),
                "runtimeCategories": _categories(obj),
                "runtimeModifiers": sorted(set(_modifiers(obj))),
            })
            for member_name, raw in vars(obj).items():
                func = _unwrap(raw)
                if not (inspect.isfunction(func) or inspect.iscoroutinefunction(func)):
                    continue
                # Some metaclasses (EnumMeta) copy inherited members into the
                # class dict, so vars() is not sufficient to prove the member was
                # DEFINED here. The defining module is.
                if getattr(func, "__module__", None) != module.__name__:
                    continue
                functions.append({
                    "name": member_name,
                    "qualname": getattr(func, "__qualname__", member_name),
                    "line": _line(func),
                    "ownerClass": name,
                    "runtimeKind": _method_kind(obj, member_name, raw, func),
                })
        elif inspect.isfunction(obj) and obj.__module__ == module.__name__:
            functions.append({
                "name": name,
                "qualname": getattr(obj, "__qualname__", name),
                "line": _line(obj),
                "ownerClass": "",
                "runtimeKind": _method_kind(None, name, obj, obj),
            })

    json.dump({"classes": classes, "functions": functions}, sys.stdout, indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
