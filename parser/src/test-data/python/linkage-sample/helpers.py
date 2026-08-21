"""Nested functions and passthrough. All callees internal."""


def build_pipeline(steps, *, strict=False):
    def register(step, weight=1):
        def normalise(value):
            return scale(value, weight)
        return normalise(step)

    def summarise(acc):
        return acc

    collected = register(steps)
    return summarise(collected)


def scale(value, weight):
    return value


def passthrough(*args, **kwargs):
    """Forwards both — argFlowIsPrecise must be false at the target site."""
    return target(*args, **kwargs)


def target(a, b, c=3, *rest, key=None, **extra):
    """Declares varargs but forwards nothing."""
    return scale(a, b)
