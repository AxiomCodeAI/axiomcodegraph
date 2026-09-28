package demo.order;

public class OrderService {
    private final OrderMapper mapper;

    public OrderService(OrderMapper mapper) { this.mapper = mapper; }

    public Order resolve(String number) {
        return mapper.findByNumber(number);
    }
}
