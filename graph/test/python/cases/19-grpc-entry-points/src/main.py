"""A gRPC servicer is invoked by the framework, never by a call site here.

The positive half is the four rpc overrides. The NEGATIVE half is the point of the case:
each of these would be rooted if one condition of the rule were dropped.
"""
import greet_pb2_grpc


# ── the real thing ──────────────────────────────────────────────────────────
class GreeterServicer(greet_pb2_grpc.GreeterServicer):
    """Subclasses the GENERATED base, so grpc invokes these on a request."""

    def SayHello(self, request, context):
        return self._render(request)

    def StreamReplies(self, request, context):
        yield self._render(request)

    def Chat(self, request_iterator, context):
        for r in request_iterator:
            yield self._render(r)

    def _render(self, request):
        """NOT an rpc. The generated base does not declare it, so it must not be rooted —
        it is reached THROUGH the rpcs, which is a different claim."""
        return request

    def helper_named_like_nothing(self):
        """Also not declared by the base."""
        return None


# ── not servicers, and each would be one if a condition were dropped ────────
class OrderServicer:
    """`*Servicer` by name, hand-written, no generated base. The suffix alone is not it."""

    def SayHello(self, request, context):
        return None


class StubUser(greet_pb2_grpc.GreeterStub):
    """Derives from the generated module — but from a Stub, not a `*Servicer` base."""

    def SayHello(self, request, context):
        return None


class SubclassOfNonService(greet_pb2_grpc.NotAService):
    """Derives from a generated-module class whose name lacks the suffix."""

    def SayHello(self, request, context):
        return None


def serve(server):
    greet_pb2_grpc.add_GreeterServicer_to_server(GreeterServicer(), server)
