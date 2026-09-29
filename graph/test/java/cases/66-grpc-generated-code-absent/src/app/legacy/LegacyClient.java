package app.legacy;

import gen.v0.OrderServiceGrpc;

public class LegacyClient {
    private OrderServiceGrpc.OrderServiceBlockingStub stub;

    String place(String sku) { return stub.placeOrder(sku); }
}
