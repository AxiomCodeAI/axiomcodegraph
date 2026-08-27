"""A target-replacing decorator, and an identity one, so the two are distinguishable.

`@retry(2)` replaces the decorated function with `inner`; a call through the decorated
name reaches `inner`, and only then the original. `@audited` returns the function
untouched, so the name still means the `def`. An engine that treats these the same is
wrong about one of them.
"""
import functools
from typing import Any, Callable, List

AUDIT_LOG: List[str] = []


def retry(times: int = 2):
    def outer(fn: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(fn)
        def inner(*args: Any, **kwargs: Any) -> Any:
            last = None
            for _ in range(times):
                last = fn(*args, **kwargs)
            return last

        return inner

    return outer


def audited(fn: Callable[..., Any]) -> Callable[..., Any]:
    # Identity: returns its own parameter, so the decorated name still means the `def`.
    AUDIT_LOG.append(fn.__name__)
    return fn
