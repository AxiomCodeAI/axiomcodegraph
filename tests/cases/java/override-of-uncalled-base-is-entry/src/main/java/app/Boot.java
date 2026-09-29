package app;

public class Boot {
    public Handler handler() {
        return new OrdersHandler();
    }

    public void report() {
        Lister l = new OrderLister();
        l.listAll();
    }
}
