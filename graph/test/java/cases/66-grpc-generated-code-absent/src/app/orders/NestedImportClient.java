package app.orders;

import gen.v1.OrderServiceGrpc.OrderServiceBlockingStub;

// the nested stub imported directly: the external name is then package-qualified
public class NestedImportClient {
    private OrderServiceBlockingStub stub;

    String place(String sku) { return stub.placeOrder(sku); }
}
