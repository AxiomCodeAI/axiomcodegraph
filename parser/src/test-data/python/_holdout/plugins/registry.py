"""Cross-package resolution plus a dict-dispatch table of in-root callables."""
from engine.events import Channel, Dispatcher, Event


def make_channel(name):
    return Channel(name)


def make_dispatcher(name):
    # local -> in-root function -> Channel, then passed as a constructor argument
    channel = make_channel(name)
    return Dispatcher(channel)


class Plugin:
    def __init__(self, name):
        self.name = name
        self.dispatcher = make_dispatcher(name)

    def emit(self, kind):
        event = Event(kind, self.name)
        self.dispatcher.accept(event)
        return event.describe()

    def flush(self):
        # depth-2 chain off an attribute that came from a module function
        return self.dispatcher.replay()

    def chained(self, kind):
        # CALL_RESULT twice over, all in-root
        return self.dispatcher.accept(Event(kind, None)).replay()


class LoggingPlugin(Plugin):
    def emit(self, kind):
        # SUPER across packages
        return super().emit(kind)

    def peek(self):
        # depth-3: self.dispatcher -> Dispatcher, .channel -> Channel, .head() -> Event
        return self.dispatcher.channel.head().describe()
