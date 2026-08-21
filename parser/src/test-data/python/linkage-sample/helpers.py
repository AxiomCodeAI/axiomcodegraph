"""Nested functions and passthrough."""


def build_pipeline(steps, *, strict=False):
    seen = []

    def register(step, weight=1):
        """Nested def — closes over `seen`."""
        def normalise(value):
            """Doubly nested def."""
            return value * weight
        seen.append(normalise(step))
        return normalise

    for s in steps:
        register(s)

    def summarise():
        nonlocal seen
        seen = sorted(seen)
        return seen

    return summarise()


def passthrough(*args, **kwargs):
    """Provably unsound arg->param flow."""
    return target(*args, **kwargs)


def target(a, b, c=3, *rest, key=None, **extra):
    return [a, b, c, key]
