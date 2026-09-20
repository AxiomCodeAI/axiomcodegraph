package probe;

// The generated holder, as protoc emits it: the service base and the client stubs are NESTED types of
// the same outer class, which is what pairs a call with the handler that serves it.
final class GreeterGrpc {
    static abstract class GreeterImplBase {
        void sayHello(String req, Observer obs) {}
        void sayBye(String req, Observer obs) {}
    }
    static class GreeterBlockingStub { String sayHello(String req) { return null; } }
    static class GreeterStub { void sayBye(String req, Observer obs) {} }
}

interface Observer { void onNext(String v); }

// the server: an ImplBase override, invoked by the runtime and by no call site
class GreeterService extends GreeterGrpc.GreeterImplBase {
    @Override void sayHello(String req, Observer obs) { obs.onNext(reply()); }
    @Override void sayBye(String req, Observer obs) { obs.onNext(""); }
    String reply() { return "hi"; }
}

// NOT generated: the right suffix and the right method name, but no *Grpc holder above it, so pairing
// it with GreeterService.sayHello would be a false positive
class RequestStub { String sayHello(String req) { return null; } }

public class GrpcProbe {
    // blocking stub: (request) — one argument
    String blocking(GreeterGrpc.GreeterBlockingStub s) { return s.sayHello("r"); }
    // async stub: (request, observer) — a DIFFERENT arity for the same rpc, which is why the pairing
    // key is the holder and the method name and not the argument count
    void async(GreeterGrpc.GreeterStub s) { s.sayBye("r", null); }
    // the decoy must not pair
    String decoy(RequestStub s) { return s.sayHello("r"); }
}
