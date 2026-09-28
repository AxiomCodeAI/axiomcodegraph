import functools

from plugin_host import hooks
from plugin_host.workers import Worker


@hooks.on_boot
def warm_caches(app):
    return app


@functools.lru_cache(maxsize=None)
def cached_helper():
    return 2


def plain_helper():
    return 1


class Nightly(Worker):
    def run(self):
        return 3

    def _private_step(self):
        return 4


class Ledger:
    def total(self):
        return 5
