"""The pure-Python implementations a facade can re-export."""


def slow(x: int) -> int:
    return x * 2


def fallback(x: int) -> int:
    return x * 3
