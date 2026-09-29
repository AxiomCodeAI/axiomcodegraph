"""Two registered tasks (one with bind=True), an unregistered function, and a class
whose method is also called `delay`."""

from taskqueue import shared_task


@shared_task
def send_report(key):
    return key


@shared_task(bind=True)
def retry_report(self, key):
    return key


def plain(key):
    return key


class Animation:
    def delay(self, ms):
        return ms
