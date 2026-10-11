package app;

public class OrderHandler extends OrderServiceGrpc.OrderServiceImplBase {
    private final OrderStore store = new OrderStore();
    @Override public void placeOrder(String req) { store.save(req); }
}
