package demo.web;
import demo.order.Order;
import demo.order.OrderMapper;
public class OrderRepository {
    private final OrderMapper orders;
    public OrderRepository(OrderMapper orders) { this.orders = orders; }
    public Order findById(String id) { return orders.findById(id); }
    public Order loadByNumber(String number) { return orders.findByNumber(number); }
}
