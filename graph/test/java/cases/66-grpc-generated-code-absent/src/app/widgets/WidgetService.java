package app.widgets;

import gen.v2.*;
import io.grpc.stub.StreamObserver;

// CONTROL (declared limit): the holder is reachable only through an on-demand import, so its
// package is not known. The rpc is still an entry point; no remote edge is paired on a guess.
public class WidgetService extends WidgetGrpc.WidgetImplBase {
    @Override
    public void build(String request, StreamObserver<String> responseObserver) {
        responseObserver.onNext(request);
    }
}
