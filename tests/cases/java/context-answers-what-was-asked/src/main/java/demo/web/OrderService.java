package demo.web;

import demo.order.Order;
import demo.order.OrderMapper;
import demo.order.OrderPlaced;
import org.springframework.context.ApplicationEventPublisher;

public class OrderService {
    private final OrderMapper mapper;
    private final ApplicationEventPublisher events;

    public OrderService(OrderMapper mapper, ApplicationEventPublisher events) {
        this.mapper = mapper;
        this.events = events;
    }

    public Order loadByNumber(String number) {
        return mapper.findByNumber(number);
    }

    public void place(String number) {
        Order o = loadByNumber(number);
        announce(o);
    }

    private void announce(Order o) {
        events.publishEvent(new OrderPlaced(o.number));
    }

    public int total(Order o) {
        return format(o) + 1;
    }

    private int format(Order o) {
        return o.number.length();
    }
}
