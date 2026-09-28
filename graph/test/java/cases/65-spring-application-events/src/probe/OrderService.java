package probe;

import org.springframework.context.ApplicationContext;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class OrderService {
    private final ApplicationEventPublisher publisher;
    private final ApplicationContext ctx;
    private final Audit audit;
    private final LocalBus bus;

    public OrderService(ApplicationEventPublisher publisher, ApplicationContext ctx, Audit audit, LocalBus bus) {
        this.publisher = publisher; this.ctx = ctx; this.audit = audit; this.bus = bus;
    }

    // a field receiver and a `new` argument
    public void place() { publisher.publishEvent(new OrderPlaced("1")); }

    // a subtype of OrderPlaced: reaches the OrderPlaced listeners AND the ExpressOrderPlaced one
    public void placeExpress() { publisher.publishEvent(new ExpressOrderPlaced("2")); }

    // the context as publisher, and a local carrying the event
    public void ship() {
        OrderShipped shipped = new OrderShipped(this);
        ctx.publishEvent(shipped);
    }

    // a parameter as receiver and as event
    public void relay(ApplicationEventPublisher p, OrderCancelled e) { p.publishEvent(e); }

    // published from inside a lambda: attributed to the method the lambda is written in
    public void placeAll(List<String> ids) { ids.forEach(id -> publisher.publishEvent(new OrderPlaced(id))); }

    // control: a direct call, which resolved before this change
    public void placeDirect() { audit.direct(new OrderPlaced("3")); }

    // control: a project class with its own publishEvent is not a Spring publisher
    public void placeLocal() { bus.publishEvent(new OrderPlaced("4")); }
}
