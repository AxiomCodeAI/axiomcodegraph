#!/usr/bin/env python3
"""Adjudicate the unrecognised-decorator DEFAULT against real, unseen decorators.

The default (spec section 2.3) says: an unrecognised decorator does not change
methodKind; classify structurally. That is an OPEN-WORLD decision, and no fixture
can contradict it -- a fixture only ever contains decorators someone thought to
write.

But it is not unfalsifiable. It is falsifiable by MEASUREMENT, because tier 2
gives ground truth for exactly this question: import a stdlib module, look at what
the decorated name actually became, and compare against what the structural rule
would have predicted. The stdlib is full of decorators nobody on this project
wrote, which is precisely the population the default is a bet about.

This measures the error rate of that bet.

  disagreement = the structural prediction differs from the runtime descriptor
                 for a method carrying at least one UNRECOGNISED decorator.

Usage:  measure_decorator_default.py --limit 300
"""

import argparse
import ast
import collections
import functools
import importlib
import importlib.util
import inspect
import json
import os
import pkgutil
import sys
import sysconfig

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from emit_introspection import (  # noqa: E402
    _NEVER_IMPORT, _STDLIB_ROOTS, Refused, _assert_importable,
)
from emit_oracle import _STDLIB_METHOD_DECORATORS, _decorator_tail, _has_yield  # noqa: E402


def structural_prediction(node, in_class):
    """What spec section 2.3's default would answer, ignoring decorators."""
    if isinstance(node, ast.AsyncFunctionDef):
        return "ASYNC_GENERATOR" if _has_yield(node) else "ASYNC_FUNCTION"
    if _has_yield(node):
        return "GENERATOR"
    if in_class:
        n = node.name
        if n in ("__init_subclass__", "__class_getitem__"):
            return "CLASS_METHOD"
        if n == "__init__":
            return "CONSTRUCTOR"
        if n == "__new__":
            return "ALLOCATOR"
        if n.startswith("__") and n.endswith("__"):
            return "DUNDER_METHOD"
        return "INSTANCE_METHOD"
    return "FUNCTION"


#: How a runtime descriptor maps onto the methodKind vocabulary.
_DESCRIPTOR_KIND = {
    staticmethod: "STATIC_METHOD",
    classmethod: "CLASS_METHOD",
    property: "PROPERTY_GETTER",
    functools.cached_property: "PROPERTY_GETTER",
}


def runtime_kind(raw, name, in_class=True):
    t = type(raw)
    if t in _DESCRIPTOR_KIND:
        return _DESCRIPTOR_KIND[t]
    if inspect.isfunction(raw):
        if inspect.isasyncgenfunction(raw):
            return "ASYNC_GENERATOR"
        if inspect.iscoroutinefunction(raw):
            return "ASYNC_FUNCTION"
        if inspect.isgeneratorfunction(raw):
            return "GENERATOR"
        if name == "__init__":
            return "CONSTRUCTOR"
        if name == "__new__":
            return "ALLOCATOR"
        if name.startswith("__") and name.endswith("__"):
            return "DUNDER_METHOD"
        return "INSTANCE_METHOD" if in_class else "FUNCTION"
    return "NON_FUNCTION:" + t.__name__


def measure(limit):
    names = []
    for root in _STDLIB_ROOTS:
        for m in pkgutil.iter_modules([root]):
            if m.name.startswith("_") or m.name in _NEVER_IMPORT:
                continue
            names.append(m.name)
    names = sorted(set(names))[:limit]

    stats = collections.Counter()
    disagreements = []
    decorator_freq = collections.Counter()
    decorator_bad = collections.Counter()
    modules_ok = 0

    for mod_name in names:
        try:
            _assert_importable(mod_name)
            spec = importlib.util.find_spec(mod_name)
            origin = getattr(spec, "origin", None)
            if not origin or not origin.endswith(".py"):
                continue
            src = open(origin, "rb").read()
            tree = ast.parse(src, filename=origin)
            module = importlib.import_module(mod_name)
        except (Refused, Exception):
            continue
        modules_ok += 1

        for cls_node in [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]:
            cls = getattr(module, cls_node.name, None)
            if not isinstance(cls, type) or getattr(cls, "__module__", None) != mod_name:
                continue
            for m in cls_node.body:
                if not isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                decos = [_decorator_tail(d) for d in m.decorator_list]
                recognised = [d for d in decos if d in _STDLIB_METHOD_DECORATORS]
                unrecognised = [d for d in decos
                                if d and d not in _STDLIB_METHOD_DECORATORS]
                if not unrecognised:
                    continue
                # The DEFAULT only governs when NOTHING is recognised. If a
                # recognised decorator is present, spec rules 5-9 decide and the
                # default never runs -- counting those was inflating the rate.
                if recognised:
                    stats["governed_by_recognised_rule"] += 1
                    continue
                raw = vars(cls).get(m.name)
                if raw is None:
                    stats["absent_at_runtime"] += 1
                    continue
                predicted = structural_prediction(m, in_class=True)
                actual = runtime_kind(raw, m.name)
                stats["measured"] += 1
                for d in unrecognised:
                    decorator_freq[d] += 1
                if predicted == actual:
                    stats["agree"] += 1
                else:
                    stats["disagree"] += 1
                    for d in unrecognised:
                        decorator_bad[d] += 1
                    if len(disagreements) < 40:
                        disagreements.append({
                            "module": mod_name, "class": cls_node.name,
                            "method": m.name, "line": m.lineno,
                            "decorators": unrecognised,
                            "structuralPrediction": predicted,
                            "runtimeActual": actual,
                        })

    measured = stats["measured"] or 1
    return {
        "modulesImported": modules_ok,
        "decoratedMethodsWithUnrecognisedDecorator": stats["measured"],
        "agree": stats["agree"],
        "disagree": stats["disagree"],
        "absentAtRuntime": stats["absent_at_runtime"],
        "excludedGovernedByRecognisedRule": stats["governed_by_recognised_rule"],
        "defaultErrorRatePct": round(100.0 * stats["disagree"] / measured, 2),
        "distinctUnrecognisedDecorators": len(decorator_freq),
        "topUnrecognisedDecorators": decorator_freq.most_common(20),
        "decoratorsCausingDisagreement": decorator_bad.most_common(20),
        "disagreementSamples": disagreements,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=300)
    args = ap.parse_args()
    json.dump(measure(args.limit), sys.stdout, indent=1, sort_keys=True, default=str)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
