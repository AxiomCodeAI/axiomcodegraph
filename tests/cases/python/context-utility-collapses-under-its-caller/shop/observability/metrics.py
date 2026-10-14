import time


class Metrics:
    def __init__(self):
        self.counts = {}

    def increment(self, key, value=1):
        self.counts[key] = self.counts.get(key, 0) + value

    def timing(self, key, started):
        self.counts[key + ".ms"] = (time.time() - started) * 1000


metrics = Metrics()


def increment(key, value=1):
    metrics.increment(key, value)
