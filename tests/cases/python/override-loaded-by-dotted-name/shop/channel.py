from importlib import import_module

from shop.base import Sender

# a registry of senders by their dotted path: each class is imported on first use, so no line constructs it by name.
# Fax is written only as a bare word, which is not a path anything can import.
SENDERS = {
    "pager": "shop.senders.Pager",
    "fax": "Fax",
}


class Channel:
    def __init__(self, kind, name):
        self.kind = kind
        self.name = name

    def sender(self) -> Sender:
        path = SENDERS[self.kind]
        module, _, cls = path.rpartition(".")
        return getattr(import_module(module), cls)(self)

    def send(self, text):
        return self.sender().notify(text)
