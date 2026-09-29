package app.orders;

import gen.v1.OrderServiceGrpc;
import io.grpc.stub.StreamObserver;

// protoc ran at build time: gen.v1.OrderServiceGrpc is NOT in this tree, so the base is external
public class OrderServiceImpl extends OrderServiceGrpc.OrderServiceImplBase {
    // unary rpc: (request, response observer)
    @Override
    public void placeOrder(String request, StreamObserver<String> responseObserver) {
        responseObserver.onNext(audit(request));
    }

    // client-streaming rpc: (response observer) -> request observer
    @Override
    public StreamObserver<String> streamOrders(StreamObserver<String> responseObserver) {
        return responseObserver;
    }

    // CONTROL: a helper with the rpc's name but no observer is not the rpc
    public String placeOrder(String sku) { return audit(sku); }

    // CONTROL: a plain helper is neither an entry point nor served
    String audit(String sku) { return sku; }
}
