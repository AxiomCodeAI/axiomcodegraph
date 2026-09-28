package probe;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.ApplicationEventPublisherAware;
import org.springframework.stereotype.Component;

// the publisher handed over through ApplicationEventPublisherAware and kept in a field
@Component
public class Refunds implements ApplicationEventPublisherAware {
    private ApplicationEventPublisher events;

    @Override
    public void setApplicationEventPublisher(ApplicationEventPublisher events) { this.events = events; }

    public void refund() { events.publishEvent(new OrderCancelled()); }
}
