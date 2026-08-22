"""Event dispatch. Deliberately unlike the node/registry/builder shapes used
in the visible corpora: dict-dispatch, mutual recursion, an attribute set from a
parameter, and a class attribute holding an instance."""


class Event:
    def __init__(self, kind, payload):
        self.kind = kind
        self.payload = payload

    def describe(self):
        return self.kind

    def with_payload(self, payload):
        return Event(self.kind, payload)


class Channel:
    def __init__(self, name):
        self.name = name
        self.queue = []

    def push(self, event):
        self.queue.append(event)
        return self

    def drain(self):
        out = self.queue
        self.queue = []
        return out

    def head(self):
        return self.queue[0]


class Dispatcher:
    # class attribute holding an instance of another in-root class
    fallback = Channel("fallback")

    def __init__(self, channel):
        # attribute set from a PARAMETER, not a constructor call
        self.channel = channel
        self.seen = 0

    def accept(self, event):
        self.seen = self.seen + 1
        self.channel.push(event)
        return self

    def replay(self):
        for event in self.channel.drain():
            self.handle(event)
        return self.seen

    def handle(self, event):
        # mutual recursion between two methods on the same class
        if event.kind == "wrapped":
            return self.handle(event.with_payload(None))
        return event.describe()

    def use_fallback(self):
        # receiver is a CLASS ATTRIBUTE holding an instance
        return Dispatcher.fallback.push(Event("f", None))
