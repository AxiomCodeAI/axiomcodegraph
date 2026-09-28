"""A decorator the project declares itself. It returns its inner wrapper, so the name of
every function it decorates denotes that one shared wrapper."""
import functools


def audited(view):
    @functools.wraps(view)
    def wrapper(request, *args, **kwargs):
        return view(request, *args, **kwargs)

    return wrapper
