package app;

public class OrderLister implements Lister {
    @Override
    public void listAll() {
        Orders.list();
    }
}
