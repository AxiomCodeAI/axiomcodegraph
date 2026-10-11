package app.orders;

import gen.v1.OrderServiceGrpc;
import io.grpc.stub.StreamObserver;
import lib.RequestStub;
import lib.ShapeGrpc;

public class OrderClient {
    private OrderServiceGrpc.OrderServiceBlockingStub blockingStub;
    private OrderServiceGrpc.OrderServiceStub asyncStub;
    private OrderServiceGrpc.OrderServiceFutureStub futureStub;
    private OrderServiceGrpc.OrderServiceBlockingV2Stub v2Stub;
    private RequestStub requestStub;
    private ShapeGrpc.OrderServiceBlockingStub mismatchedStub;

    String placeBlocking(String sku) { return blockingStub.placeOrder(sku); }
    void placeAsync(String sku, StreamObserver<String> obs) { asyncStub.placeOrder(sku, obs); }
    Object placeFuture(String sku) { return futureStub.placeOrder(sku); }
    String placeV2(String sku) { return v2Stub.placeOrder(sku); }
    StreamObserver<String> stream(StreamObserver<String> obs) { return asyncStub.streamOrders(obs); }

    // CONTROL: a stub method that is not an rpc has no handler to pair with
    Object configure() { return blockingStub.withDeadlineAfter(1, null); }
    // CONTROL: the Stub suffix with no <S>Grpc holder above it is not a generated stub
    String decoyNoHolder(String sku) { return requestStub.placeOrder(sku); }
    // CONTROL: a holder that does not spell the stub's service is not a generated stub
    String decoyWrongHolder(String sku) { return mismatchedStub.placeOrder(sku); }
}
