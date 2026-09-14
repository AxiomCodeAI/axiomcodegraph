"""Positional-only (PEP 570) and keyword-only params, *args/**kwargs,
tuple unpacking of return values, and default-argument evaluation timing
(defaults are evaluated once, at def time, in the enclosing scope)."""

_DEFAULT_TAG_COUNTER = 0


def _next_tag():
    global _DEFAULT_TAG_COUNTER
    _DEFAULT_TAG_COUNTER += 1
    return _DEFAULT_TAG_COUNTER


def build(pos_only, /, normal, *, kw_only, kw_with_default="x"):
    return pos_only, normal, kw_only, kw_with_default


def full_signature(a, b, /, c, d=10, *args, e, f=20, **kwargs):
    return a, b, c, d, args, e, f, kwargs


def tagged(value, tag=_next_tag()):
    # `_next_tag()` runs exactly once, when this function is defined, not
    # once per call — every caller that omits `tag` shares that one value
    return value, tag


def swap_via_unpacking(pair):
    a, b = pair
    b, a = a, b
    return a, b


def unpack_with_star(items):
    first, *middle, last = items
    return first, middle, last


def nested_unpack(records):
    results = []
    for (name, (lat, lon)), count in records:
        results.append((name, lat, lon, count))
    return results


def call_with_everything(*args, **kwargs):
    return full_signature(*args, **kwargs)
