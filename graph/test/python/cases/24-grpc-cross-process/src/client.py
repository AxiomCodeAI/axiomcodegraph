"""The client half: a send has no call site into the server, only a destination string."""
import greet_pb2_grpc


def via_stub(channel):
    """The ordinary shape. `stub.SayHello` never resolves — it is an attribute assigned
    from a library multicallable — so the receiver TYPE and the call NAME identify the rpc."""
    stub = greet_pb2_grpc.GreeterStub(channel)
    return stub.SayHello(None)


def via_stub_streaming(channel):
    return list(greet_pb2_grpc.GreeterStub(channel).Chat(iter(())))


def via_raw_channel(channel):
    """No stub at all: the author writes the wire name. The sharpest case, because nothing
    generated stands between the literal and the send."""
    rpc = channel.unary_unary("/greet.Greeter/StreamReplies", _registered_method=True)
    return rpc(None)


def not_a_send(channel):
    """A `/`-leading literal that is NOT an rpc name: it is not argument 0 of a channel verb."""
    return channel.subscribe("/greet.Greeter/SayHello")
