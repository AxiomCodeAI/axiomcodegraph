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
    """A stub is not a servicer: its methods are assigned, and nothing invokes them for us."""

    def __init__(self, channel):
        self.SayHello = channel


class NotAService:
    """In the generated module, but not a `*Servicer` — the suffix is the other condition."""

    def SayHello(self, request, context):
        raise NotImplementedError


def add_GreeterServicer_to_server(servicer, server):
    return None
