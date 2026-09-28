package com.example;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
@Service
public class OrderService {
    private final ApplicationEventPublisher publisher;
    private final Helper helper;
    public OrderService(ApplicationEventPublisher publisher, Helper helper) { this.publisher = publisher; this.helper = helper; }
    public void place(String id) { publisher.publishEvent(new OrderPlaced(id)); }
    public void direct(String id) { helper.run(id); }
    // the event is typed Object here, so no listener type can be matched to it statically
    public void relay(Object payload) { publisher.publishEvent(payload); }
}
