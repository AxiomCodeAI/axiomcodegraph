"""A PEP 561 stub-only module: declarations, and no `.py` beside it.

This is what a typed third-party distribution looks like when it ships no Python
implementation. Every body here is `...`, nothing is importable, and a call that
commits to one of these declarations asserts an edge into a body that does not exist.
"""


class Gauge:
    def read(self) -> int: ...


def open_gauge() -> Gauge: ...
