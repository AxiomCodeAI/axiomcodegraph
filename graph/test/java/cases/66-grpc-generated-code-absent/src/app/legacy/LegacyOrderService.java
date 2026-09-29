package app.legacy;

import gen.v0.OrderServiceGrpc;
import io.grpc.stub.StreamObserver;

// CONTROL: the SAME written holder name from another package (an older API version). It must pair
// only with the v0 client, never with the v1 one.
public class LegacyOrderService extends OrderServiceGrpc.OrderServiceImplBase {
    @Override
    public void placeOrder(String request, StreamObserver<String> responseObserver) {
        responseObserver.onNext(request);
    }
}
