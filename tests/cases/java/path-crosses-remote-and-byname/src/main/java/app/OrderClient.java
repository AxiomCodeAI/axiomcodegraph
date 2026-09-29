package app;

public class OrderClient {
    private OrderServiceGrpc.OrderServiceBlockingStub stub = new OrderServiceGrpc.OrderServiceBlockingStub();
    public String placeBlocking(String req) { return stub.placeOrder(req); }
}
