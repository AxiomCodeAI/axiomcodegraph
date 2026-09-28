package demo.order;

import java.util.HashMap;
import java.util.Map;

public class OrderAudit {
    private final Map<String, Order> seen = new HashMap<>();

    public Order findByNumber(String number) {
        return seen.get(Order.toNumber(number));
    }
}
