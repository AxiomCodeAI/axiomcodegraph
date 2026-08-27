"""THE CROSS-SERVICE SEAM.

Orders talks to Inventory through `Transport`, which has two implementations that are
BOTH constructed by main.py and only one of which runs. That is deliberate: a sound
static answer is the two-element set, the runtime answer is one of them, and the gap
between those is exactly what a dispatch tier is for.

InProcessTransport dispatches through a dict whose key is a PARAMETER — a genuine blind
spot, and the point where an honest engine has to stop. HttpTransport calls out to
`requests`, which is not in the staged stdlib IR at all.
"""
from abc import ABC, abstractmethod
from typing import Any, Callable, Dict, Iterable, List, Mapping

Payload = Dict[str, Any]
Handler = Callable[[Payload], Payload]


class Transport(ABC):
    @abstractmethod
    def send(self, route: str, payload: Payload) -> Payload:
        ...

    def send_many(self, route: str, payloads: Iterable[Payload]) -> List[Payload]:
        # Template method over an abstract call.
        return [self.send(route, p) for p in payloads]

    def describe(self) -> str:
        return type(self).__name__


class InProcessTransport(Transport):
    """A registry dispatch. The route is data, so the callee is data."""

    def __init__(self, registry: Mapping[str, Handler]):
        self._registry = registry

    def send(self, route: str, payload: Payload) -> Payload:
        handler = self._registry[route]          # key is a PARAMETER -> unpinnable
        return handler(payload)


class HttpTransport(Transport):
    """Real HTTP. `requests` has no Python source in the staged library IR."""

    def __init__(self, base_url: str, session: Any):
        self.base_url = base_url
        self.session = session

    def send(self, route: str, payload: Payload) -> Payload:
        response = self.session.post(self.base_url + "/" + route, json=payload)
        return response.json()


class RecordingTransport(Transport):
    """Decorator-pattern over another Transport — a chained polymorphic call."""

    def __init__(self, inner: Transport):
        self.inner = inner
        self.sent: List[str] = []

    def send(self, route: str, payload: Payload) -> Payload:
        self.sent.append(route)
        return self.inner.send(route, payload)    # -> Transport.send, all impls
