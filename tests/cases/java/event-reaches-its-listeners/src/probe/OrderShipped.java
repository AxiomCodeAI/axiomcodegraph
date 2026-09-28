package probe;

import org.springframework.context.ApplicationEvent;

public class OrderShipped extends ApplicationEvent {
    public OrderShipped(Object source) { super(source); }
}
