__all__ = ["chunk"]


def chunk(xs, n):
    return [xs[i:i + n] for i in range(0, len(xs), n)]
