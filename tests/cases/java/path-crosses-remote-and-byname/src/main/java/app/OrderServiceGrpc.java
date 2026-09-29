package app;

public final class OrderServiceGrpc {
    public static abstract class OrderServiceImplBase { public void placeOrder(String req) { } }
    public static class OrderServiceBlockingStub { public String placeOrder(String req) { return null; } }
}
