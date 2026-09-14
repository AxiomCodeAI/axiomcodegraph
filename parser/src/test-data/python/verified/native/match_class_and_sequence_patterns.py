"""match/case fixture: class patterns, sequence patterns, mapping patterns,
literal/complex patterns, union (`|`) patterns, guards, and `as` capture —
each chosen to bind (or deliberately not bind) names so the oracle's
py_binding set-equality has real cases to adjudicate.
"""


class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y


def describe(point):
    match point:
        case Point(x=0, y=0):
            # no bindings: both sub-patterns are literal patterns
            return "origin"
        case Point(x=0, y=y):
            # keyword_pattern binds `y`
            return f"Y-axis at {y}"
        case Point(x=x, y=0) as p:
            # keyword_pattern binds `x`; as_pattern binds `p` to the whole match
            return f"X-axis at {x} via {p}"
        case Point(x=x, y=y) if x == y:
            # guard (if_clause) reads bindings made by the pattern itself
            return "diagonal"
        case [Point(0, 0)]:
            # positional class_pattern nested inside a sequence pattern, no bindings
            return "single origin in a list"
        case [Point(x1, y1), Point(x2, y2)]:
            # two positional class_patterns, four captures
            return (x1, y1, x2, y2)
        case [first, *rest]:
            # splat_pattern binds `rest`, plain capture binds `first`
            return (first, rest)
        case [*_]:
            # splat_pattern with wildcard target — binds nothing
            return "any sequence"
        case {"kind": "circle", "radius": r, **extra}:
            # dict_pattern: literal key with capture value `r`, plus a
            # splat_pattern rest-capture `extra` (the `**rest` form)
            return (r, extra)
        case {}:
            # empty dict_pattern — matches any mapping, binds nothing
            return "empty-or-unmatched-mapping"
        case (1 | 2 | 3):
            # union_pattern over literal patterns, no bindings
            return "small"
        case 1 + 2j:
            # complex_pattern (real + imaginary literal pair)
            return "complex"
        case -1 - 2j:
            # complex_pattern with negated real and imaginary parts
            return "negative complex"
        case str() | bytes():
            # union_pattern over two class_patterns with no sub-patterns
            return "stringish"
        case Point() as p2:
            # bare class_pattern (no args) captured via as_pattern
            return p2
        case _:
            return "unknown"


def match_tuple_subject(a, b):
    match a, b:
        case (0, 0):
            return "both zero"
        case (x, 0) | (0, x):
            # union_pattern whose two alternatives bind the same name `x`
            return x
        case (x, y):
            return x + y


def match_with_walrus_guard(items):
    match items:
        case [head, *tail] if (n := len(tail)) > 0:
            # guard binds `n` via walrus; scope is the enclosing function,
            # not the match statement
            return head, tail, n
        case []:
            return None
