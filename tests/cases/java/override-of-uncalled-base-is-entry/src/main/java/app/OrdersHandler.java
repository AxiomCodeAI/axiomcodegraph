package app;

public class OrdersHandler extends Handler {
    @Override
    protected void handle(String req) {
        Orders.list();
    }
}
