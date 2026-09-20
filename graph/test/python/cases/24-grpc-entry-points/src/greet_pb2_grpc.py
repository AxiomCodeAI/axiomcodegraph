"""Stands in for what `grpc_python_plugin` writes. The FILE NAME is load-bearing: the rule
matches on it, because only protoc produces a module called `<stem>_pb2_grpc.py`.

Trimmed to the shape the rule reads — the service base, and a Stub beside it so the case
proves the rule does not root a stub's methods too.
"""


class GreeterServicer:
    """The generated base. It declares exactly the service's rpcs and nothing else."""

    def SayHello(self, request, context):
        raise NotImplementedError

    def StreamReplies(self, request, context):
        raise NotImplementedError

    def Chat(self, request_iterator, context):
        raise NotImplementedError


class GreeterStub:
    """A stub is not a servicer: its methods are assigned, and nothing invokes them for us.

    Each attribute carries the rpc's FULL METHOD NAME — the string the server end spells
    too, and the only thing that ties the two processes together."""

    def __init__(self, channel):
        self.SayHello = channel.unary_unary(
            '/greet.Greeter/SayHello', _registered_method=True)
        self.StreamReplies = channel.unary_stream(
            '/greet.Greeter/StreamReplies', _registered_method=True)
        self.Chat = channel.stream_stream(
            '/greet.Greeter/Chat', _registered_method=True)
        self._unused = channel


class NotAService:
    """In the generated module, but not a `*Servicer` — the suffix is the other condition."""

    def SayHello(self, request, context):
        raise NotImplementedError


def add_GreeterServicer_to_server(servicer, server):
    return None
