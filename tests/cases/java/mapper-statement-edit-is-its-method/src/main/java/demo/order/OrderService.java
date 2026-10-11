package demo.order;
import java.util.List;
public class OrderService {
    private final OrderMapper orders;
    public OrderService(OrderMapper orders) { this.orders = orders; }
    public Order load(String id) { return orders.findById(id); }
    public List<Order> open() { return orders.findOpen(); }
}
