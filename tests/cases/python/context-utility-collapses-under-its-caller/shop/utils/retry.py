import functools
import time


def retry(times=3, delay=0.1):
    def wrap(fn):
        @functools.wraps(fn)
        def inner(*args, **kwargs):
            last = None
            for attempt in range(times):
                try:
                    return fn(*args, **kwargs)
                except IOError as e:
                    last = e
                    backoff(attempt, delay)
            raise last
        return inner
    return wrap


def backoff(attempt, delay):
    time.sleep(delay * (2 ** attempt))
